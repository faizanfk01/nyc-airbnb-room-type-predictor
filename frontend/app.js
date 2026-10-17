const RENDER_URL = "https://nyc-airbnb-room-type-predictor-93bh.onrender.com";
const LOCAL_HOSTS = ["localhost", "127.0.0.1"];
const IS_LOCAL = LOCAL_HOSTS.includes(window.location.hostname);
const API_BASE = IS_LOCAL ? "http://localhost:8000" : RENDER_URL;

const LOW_CONFIDENCE = 0.6;
const HEALTH_INTERVAL_MS = 15000;
const HEALTH_TIMEOUT_MS = 10000;
const WAKE_NOTICE_MS = 3000;
const WAKE_LIMIT_MS = 90000;
const WAKE_ATTEMPT_MS = 30000;
const WAKE_RETRY_MS = 3000;

const API_MESSAGES = {
  starting: "Starting the server, this can take up to a minute…",
  offline: "Can't reach the API. Make sure the backend is running, then try again.",
};

const RULES = {
  latitude: { type: "float", min: 40.49, max: 40.92, hint: "Must be between 40.49 and 40.92 (New York City)." },
  longitude: { type: "float", min: -74.26, max: -73.70, hint: "Must be between -74.26 and -73.70 (New York City)." },
  price: { type: "float", minExclusive: 0, max: 10000, hint: "Must be more than 0 and at most 10,000." },
  minimum_nights: { type: "int", min: 1, max: 365, hint: "Must be a whole number from 1 to 365." },
  availability_365: { type: "int", min: 0, max: 365, hint: "Must be a whole number from 0 to 365." },
  number_of_reviews: { type: "int", min: 0, max: 1000, hint: "Must be a whole number from 0 to 1,000." },
  reviews_per_month: { type: "float", min: 0, max: 100, hint: "Must be between 0 and 100." },
  calculated_host_listings_count: { type: "int", min: 1, max: 1000, hint: "Must be a whole number from 1 to 1,000." },
};

const FIELD_NAMES = [...Object.keys(RULES), "neighbourhood_group", "neighbourhood"];

const EXAMPLES = [
  {
    latitude: 40.67777, longitude: -73.99893, neighbourhood_group: "Brooklyn", neighbourhood: "Carroll Gardens",
    price: 160, minimum_nights: 2, availability_365: 236, number_of_reviews: 72, reviews_per_month: 3.2, calculated_host_listings_count: 1,
  },
  {
    latitude: 40.68847, longitude: -73.913, neighbourhood_group: "Brooklyn", neighbourhood: "Bushwick",
    price: 70, minimum_nights: 1, availability_365: 0, number_of_reviews: 3, reviews_per_month: 0.16, calculated_host_listings_count: 2,
  },
  {
    latitude: 40.74967, longitude: -73.86311, neighbourhood_group: "Queens", neighbourhood: "Corona",
    price: 45, minimum_nights: 1, availability_365: 365, number_of_reviews: 16, reviews_per_month: 0.7, calculated_host_listings_count: 6,
  },
];

const form = document.getElementById("listing-form");
const boroughSelect = document.getElementById("neighbourhood_group");
const hoodSelect = document.getElementById("neighbourhood");
const availability = document.getElementById("availability_365");
const availabilityReadout = document.getElementById("availability-readout");
const predictBtn = document.getElementById("predict-btn");
const predictLabel = predictBtn.querySelector(".btn-label");
const exampleBtn = document.getElementById("example-btn");
const formMessage = document.getElementById("form-message");
const apiMessage = document.getElementById("api-message");
const resultEmpty = document.getElementById("result-empty");
const resultEl = document.getElementById("result");
const resultValue = document.getElementById("result-value");
const resultBars = document.getElementById("result-bars");
const closeCall = document.getElementById("close-call");

let options = null;
let exampleIndex = 0;
let waking = false;
let pollTimer = null;

function setFieldError(name, message) {
  const input = document.getElementById(name);
  const error = document.getElementById(`${name}-error`);
  if (!input || !error) return;
  error.textContent = message || "";
  if (message) {
    input.setAttribute("aria-invalid", "true");
  } else {
    input.removeAttribute("aria-invalid");
  }
}

function validateNumber(name) {
  const input = document.getElementById(name);
  const rule = RULES[name];
  const raw = input.value.trim();

  if (input.validity.badInput) return "Enter a number.";
  if (raw === "") return "Required.";

  const value = Number(raw);
  if (!Number.isFinite(value)) return "Enter a number.";
  if (rule.type === "int" && !Number.isInteger(value)) return rule.hint;
  if (rule.minExclusive !== undefined && value <= rule.minExclusive) return rule.hint;
  if (rule.min !== undefined && value < rule.min) return rule.hint;
  if (rule.max !== undefined && value > rule.max) return rule.hint;
  return "";
}

function validateBorough() {
  if (!boroughSelect.value) return "Choose a borough.";
  if (options && !(boroughSelect.value in options)) return "Choose a borough from the list.";
  return "";
}

function validateNeighbourhood() {
  if (!hoodSelect.value) return boroughSelect.value ? "Choose a neighbourhood." : "Choose a borough first.";
  const allowed = options ? options[boroughSelect.value] || [] : [];
  if (!allowed.includes(hoodSelect.value)) return "Choose a neighbourhood in this borough.";
  return "";
}

function validateField(name) {
  let message;
  if (name === "neighbourhood_group") message = validateBorough();
  else if (name === "neighbourhood") message = validateNeighbourhood();
  else message = validateNumber(name);
  setFieldError(name, message);
  return message === "";
}

function validateAll() {
  const names = [...FIELD_NAMES];
  const order = Array.from(form.querySelectorAll("input, select")).map((el) => el.id);
  names.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  let firstInvalid = null;
  for (const name of names) {
    if (!validateField(name) && !firstInvalid) firstInvalid = name;
  }
  return firstInvalid;
}

function collectPayload() {
  const payload = {};
  for (const [name, rule] of Object.entries(RULES)) {
    const value = Number(document.getElementById(name).value);
    payload[name] = rule.type === "int" ? Math.trunc(value) : value;
  }
  payload.neighbourhood_group = boroughSelect.value;
  payload.neighbourhood = hoodSelect.value;
  return payload;
}

function updateReadout() {
  availabilityReadout.textContent = `${availability.value} / 365 days`;
}

function fillBoroughs() {
  boroughSelect.innerHTML = "";
  boroughSelect.append(new Option("Select a borough", ""));
  for (const borough of Object.keys(options)) {
    boroughSelect.append(new Option(borough, borough));
  }
  boroughSelect.disabled = false;
}

function fillNeighbourhoods(borough) {
  hoodSelect.innerHTML = "";
  const list = (options && options[borough]) || [];
  if (!list.length) {
    hoodSelect.append(new Option("Choose a borough first", ""));
    hoodSelect.disabled = true;
    return;
  }
  hoodSelect.append(new Option("Select a neighbourhood", ""));
  for (const hood of list) {
    hoodSelect.append(new Option(hood, hood));
  }
  hoodSelect.disabled = false;
}

async function loadOptions() {
  try {
    const res = await fetch(`${API_BASE}/options`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    options = await res.json();
    fillBoroughs();
    setFieldError("neighbourhood_group", "");
  } catch {
    options = null;
    boroughSelect.innerHTML = "";
    boroughSelect.append(new Option("Couldn't load boroughs", ""));
    boroughSelect.disabled = true;
    setFieldError("neighbourhood_group", "Borough list unavailable. It will load once the API is reachable.");
  }
}

function showApiMessage(state) {
  if (!state) {
    apiMessage.hidden = true;
    return;
  }
  apiMessage.dataset.state = state;
  apiMessage.textContent = API_MESSAGES[state];
  apiMessage.hidden = false;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pingHealth(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}/health`, { cache: "no-store", signal: controller.signal });
    const data = res.ok ? await res.json() : null;
    return Boolean(data && data.status === "ok" && data.model_loaded);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function startPolling() {
  if (!pollTimer) pollTimer = setInterval(checkHealth, HEALTH_INTERVAL_MS);
}

function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
}

function markOffline() {
  showApiMessage("offline");
  startPolling();
}

async function onHealthy() {
  stopPolling();
  showApiMessage(null);
  if (!options) await loadOptions();
}

async function checkHealth() {
  if (await pingHealth(HEALTH_TIMEOUT_MS)) {
    await onHealthy();
    return true;
  }
  markOffline();
  return false;
}

async function wakeServer() {
  waking = true;
  const start = Date.now();
  const notice = setTimeout(() => showApiMessage("starting"), WAKE_NOTICE_MS);
  let ok = false;
  while (!ok && Date.now() - start < WAKE_LIMIT_MS) {
    const remaining = WAKE_LIMIT_MS - (Date.now() - start);
    ok = await pingHealth(Math.min(remaining, WAKE_ATTEMPT_MS));
    if (!ok && Date.now() - start < WAKE_LIMIT_MS) await sleep(WAKE_RETRY_MS);
  }
  clearTimeout(notice);
  waking = false;
  if (ok) {
    await onHealthy();
  } else {
    markOffline();
  }
  return ok;
}

function setLoading(isLoading) {
  predictBtn.disabled = isLoading;
  predictBtn.setAttribute("aria-busy", String(isLoading));
  predictLabel.textContent = isLoading ? "Predicting…" : "Predict room type";
}

function renderResult(data) {
  const entries = Object.entries(data.probabilities).sort((a, b) => b[1] - a[1]);
  const [top, second] = entries;

  resultValue.textContent = data.predicted_room_type;
  resultValue.dataset.class = data.predicted_room_type;
  resultBars.innerHTML = "";

  for (const [name, p] of entries) {
    const pct = `${(p * 100).toFixed(1)}%`;
    const li = document.createElement("li");
    if (name === top[0]) li.className = "is-top";

    const head = document.createElement("div");
    head.className = "bar-head";
    const label = document.createElement("span");
    label.textContent = name;
    const value = document.createElement("span");
    value.className = "pct";
    value.textContent = pct;
    head.append(label, value);

    const track = document.createElement("div");
    track.className = "bar-track";
    track.setAttribute("aria-hidden", "true");
    const fill = document.createElement("div");
    fill.className = "bar-fill";
    fill.dataset.class = name;
    track.append(fill);

    li.append(head, track);
    resultBars.append(li);
    requestAnimationFrame(() => {
      fill.style.width = pct;
    });
  }

  const isClose = top[1] < LOW_CONFIDENCE && second;
  closeCall.textContent = isClose ? `Close call between ${top[0]} and ${second[0]}` : "";
  closeCall.hidden = !isClose;
  resultEmpty.hidden = true;
  resultEl.hidden = false;
}

function applyServerErrors(detail) {
  if (!Array.isArray(detail)) return false;
  let handled = false;
  for (const err of detail) {
    const loc = err.loc || [];
    const field = loc.length > 1 ? loc[loc.length - 1] : null;
    if (field && document.getElementById(field)) {
      setFieldError(field, err.msg);
      handled = true;
    } else if (/neighbourhood/i.test(err.msg || "")) {
      setFieldError("neighbourhood", "This neighbourhood isn't in the selected borough.");
      handled = true;
    }
  }
  return handled;
}

async function handleSubmit(event) {
  event.preventDefault();
  formMessage.textContent = "";

  const firstInvalid = validateAll();
  if (firstInvalid) {
    formMessage.textContent = "Please fix the highlighted fields.";
    document.getElementById(firstInvalid).focus();
    return;
  }

  setLoading(true);
  const slowNotice = IS_LOCAL ? null : setTimeout(() => showApiMessage("starting"), WAKE_NOTICE_MS);
  try {
    const res = await fetch(`${API_BASE}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(collectPayload()),
    });
    const data = await res.json().catch(() => null);
    clearTimeout(slowNotice);
    if (!waking) await onHealthy();

    if (res.ok && data) {
      renderResult(data);
    } else if (res.status === 422 && data && applyServerErrors(data.detail)) {
      formMessage.textContent = "The API rejected some values. Check the highlighted fields.";
    } else {
      formMessage.textContent = "The prediction failed on the server. Please try again.";
    }
  } catch {
    clearTimeout(slowNotice);
    if (waking) {
      showApiMessage("starting");
    } else {
      markOffline();
    }
  } finally {
    setLoading(false);
  }
}

function fillExample() {
  if (!options) {
    formMessage.textContent = "Examples need the borough list, which hasn't loaded yet. Check that the API is running.";
    return;
  }
  const example = EXAMPLES[exampleIndex % EXAMPLES.length];
  exampleIndex += 1;

  boroughSelect.value = example.neighbourhood_group;
  fillNeighbourhoods(example.neighbourhood_group);
  hoodSelect.value = example.neighbourhood;
  for (const name of Object.keys(RULES)) {
    document.getElementById(name).value = example[name];
  }
  updateReadout();
  formMessage.textContent = "";
  for (const name of FIELD_NAMES) {
    setFieldError(name, "");
  }
}

boroughSelect.addEventListener("change", () => {
  fillNeighbourhoods(boroughSelect.value);
  validateField("neighbourhood_group");
  setFieldError("neighbourhood", "");
});

hoodSelect.addEventListener("change", () => validateField("neighbourhood"));

for (const name of Object.keys(RULES)) {
  const input = document.getElementById(name);
  input.addEventListener("blur", () => validateField(name));
  input.addEventListener("input", () => {
    if (input.getAttribute("aria-invalid") === "true") validateField(name);
  });
}

availability.addEventListener("input", updateReadout);
exampleBtn.addEventListener("click", fillExample);
form.addEventListener("submit", handleSubmit);

updateReadout();
const firstCheck = IS_LOCAL ? checkHealth() : wakeServer();

firstCheck.then((ok) => {
  if (!ok) loadOptions();
});
