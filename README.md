# NYC Airbnb Room Type Predictor

Predicts whether a New York City Airbnb listing is an **Entire home/apt**, a **Private room**, or a **Shared room** from its location, price, stay rules, review activity, and host size. A tuned Random Forest is served by a FastAPI backend (deployed on Render), with a plain HTML/CSS/JS frontend (deployed on Vercel).

## Features used

| Feature | Description |
|---|---|
| `latitude`, `longitude` | Listing coordinates |
| `neighbourhood_group` | Borough: Bronx, Brooklyn, Manhattan, Queens, Staten Island |
| `neighbourhood` | Neighbourhood within the borough |
| `price` | Price per night (USD) |
| `minimum_nights` | Minimum nights per booking |
| `number_of_reviews` | Total reviews |
| `reviews_per_month` | Average reviews per month |
| `calculated_host_listings_count` | Number of listings by the host |
| `availability_365` | Days available per year |

## Dataset

[New York City Airbnb Open Data](https://www.kaggle.com/datasets/dgomonov/new-york-city-airbnb-open-data) on Kaggle (48,895 listings from 2019).

The CSV is not included in this repository. To get it:

1. Download the dataset from the Kaggle page above.
2. Unzip it.
3. Rename `AB_NYC_2019.csv` to `nyc_data.csv` and place it in `data/`, so the path is `data/nyc_data.csv`.

The CSV is only needed to retrain the model in the notebook. The backend runs without it.

## Model and results

- **Model:** Random Forest with `class_weight="balanced"`, inside a scikit-learn pipeline (median imputation, Yeo-Johnson power transform and scaling for numeric features; one-hot encoding for borough and neighbourhood).
- **Tuning:** `RandomizedSearchCV` over `n_estimators`, `max_depth`, and `min_samples_split`, optimising macro F1 with 3-fold cross-validation.
- **Split:** stratified 67/33 train/test split (`random_state=42`).

Test set results (16,136 listings):

| Class | Precision | Recall | F1 | Support |
|---|---|---|---|---|
| Entire home/apt | 0.873 | 0.875 | 0.874 | 8,385 |
| Private room | 0.834 | 0.856 | 0.845 | 7,368 |
| Shared room | 0.812 | 0.350 | 0.489 | 383 |
| **Accuracy** | | | **0.854** | 16,136 |
| **Macro avg** | 0.840 | 0.694 | **0.736** | 16,136 |

The model is strong on Entire home/apt and Private room. It is weak on Shared room (recall 0.35) because shared rooms overlap heavily with private rooms in price and location, so the available features cannot separate them well. Threshold tuning showed a near 1:1 trade-off between Shared room recall and precision: every gain in recall cost about the same in precision. That confirms the limit comes from the features rather than the decision threshold.

## Limitations

- **Shared room predictions are unreliable.** About two thirds of shared rooms are predicted as another class, usually Private room. When the top probability is below 60%, the UI shows a "Close call between …" line naming the top two classes.
- **Four Staten Island neighbourhoods are not supported:** Fort Wadsworth, Lighthouse Hill, Richmondtown, and Woodrow. They were absent from the training split, so the model has never seen them, and the API rejects them.
- The data is a 2019 snapshot and may not reflect the current market.

## Setup

Requires Python 3.13. The pinned scikit-learn version (1.7.2) must match the one used to save the model, or the pickle may fail to load.

There are two requirements files:

- `backend/requirements.txt`: what the API needs to run.
- `notebooks/requirements.txt`: the backend requirements plus matplotlib, seaborn, and ipykernel for the notebook.

### Windows (PowerShell)

```powershell
py -3.13 -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt -c backend\constraints.txt
```

If PowerShell blocks the activation script, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.

### macOS / Linux

```bash
python3.13 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt -c backend/constraints.txt
```

### Notebook (optional)

To rerun the training notebook, install the notebook requirements and register the kernel:

```bash
pip install -r notebooks/requirements.txt
python -m ipykernel install --user --name nyc-room-type --display-name "Python (nyc-room-type)"
```

Open `notebooks/model_training.ipynb` and select the **Python (nyc-room-type)** kernel. It reads `../data/nyc_data.csv` and saves the model to `../backend/model_pipeline.pkl`.

## Run locally

The backend and frontend run as two separate servers, so use two terminals.

**Terminal 1: backend on port 8000** (virtual environment active)

```bash
cd backend
uvicorn main:app --port 8000
```

**Terminal 2: frontend on port 5500**

Either open `frontend/index.html` with the VS Code Live Server extension (it serves on port 5500 by default), or run:

```bash
cd frontend
python -m http.server 5500
```

Then open **http://localhost:5500**. When the page runs on `localhost` or `127.0.0.1`, it calls the API at `http://localhost:8000`. Interactive API docs are at http://localhost:8000/docs.

The backend only accepts browser requests from the origins in the `ALLOWED_ORIGINS` environment variable (comma-separated). When it is not set, it allows `http://localhost:5500` and `http://127.0.0.1:5500`, which covers both options above.

## Deployment

The backend runs on [Render](https://render.com) and the frontend on [Vercel](https://vercel.com). Deploy in this order, because each side needs the other's URL:

1. **Deploy the backend on Render** (settings below) and copy its URL, for example `https://nyc-room-type.onrender.com`.
2. **Set `RENDER_URL`** at the top of `frontend/app.js` to that URL, then commit and push.
3. **Deploy the frontend on Vercel** (settings below) and copy its URL, for example `https://nyc-room-type.vercel.app`.
4. **Set `ALLOWED_ORIGINS` on Render** to the Vercel URL, then choose **Save and deploy** so the running service picks it up. "Save only" stores the value without applying it until the next deploy.

### Render (backend)

| Setting | Value |
|---|---|
| Service type | Web Service |
| Root directory | `backend` |
| Build command | `pip install -r requirements.txt -c constraints.txt` |
| Start command | `uvicorn main:app --host 0.0.0.0 --port $PORT` |
| Health check path | `/health` |
| Environment variable | `ALLOWED_ORIGINS` = your Vercel URL, with no trailing slash |
| Environment variable | `PYTHON_VERSION` = `3.13.12` |

`PYTHON_VERSION` makes Render use the same Python as local development. It takes precedence over `.python-version`, and Render's docs only describe reading that file from the repository root, not from a service's root directory. `backend/.python-version` still pins 3.13.12 for local tools.

`backend/constraints.txt` pins every package the backend installs, including indirect dependencies, so Render builds the same versions that were tested locally. `requirements.txt` lists only the direct dependencies.

To allow more than one origin (for example a custom domain), separate them with commas.

Render's free tier sleeps after 15 minutes without traffic, and the first request can take up to a minute to wake it. If the first health check takes longer than 3 seconds, the page shows "Starting the server, this can take up to a minute…" and keeps retrying for up to 90 seconds. The same message appears if a prediction takes longer than 3 seconds. The page only polls `/health` while the API is unreachable, so an open tab does not keep the server awake.

### Vercel (frontend)

| Setting | Value |
|---|---|
| Root directory | `frontend` |
| Framework preset | Other |
| Build command | none |
| Output directory | default |

The frontend is static files only, so there is nothing to build.

## API

| Method | Path | Description |
|---|---|---|
| GET | `/` | API name and a link to the docs |
| GET | `/health` | Service and model status |
| GET | `/options` | Map of each borough to its supported neighbourhoods |
| POST | `/predict` | Predict the room type for one listing |

### `GET /`

```json
{"message": "NYC Room Type Predictor API", "docs": "/docs"}
```

### `GET /health`

```json
{"status": "ok", "model_loaded": true}
```

### `GET /options`

```json
{
  "Bronx": ["Allerton", "Baychester", "..."],
  "Brooklyn": ["Bath Beach", "Bay Ridge", "..."],
  "Manhattan": ["Battery Park City", "Chelsea", "..."],
  "Queens": ["Arverne", "Astoria", "..."],
  "Staten Island": ["Arden Heights", "Arrochar", "..."]
}
```

### `POST /predict`

Request (Git Bash, macOS, Linux):

```bash
curl -X POST http://localhost:8000/predict \
  -H "Content-Type: application/json" \
  -d '{
    "latitude": 40.67777,
    "longitude": -73.99893,
    "price": 160,
    "minimum_nights": 2,
    "number_of_reviews": 72,
    "reviews_per_month": 3.2,
    "calculated_host_listings_count": 1,
    "availability_365": 236,
    "neighbourhood_group": "Brooklyn",
    "neighbourhood": "Carroll Gardens"
  }'
```

Request (PowerShell):

```powershell
$body = @{
  latitude = 40.67777
  longitude = -73.99893
  price = 160
  minimum_nights = 2
  number_of_reviews = 72
  reviews_per_month = 3.2
  calculated_host_listings_count = 1
  availability_365 = 236
  neighbourhood_group = "Brooklyn"
  neighbourhood = "Carroll Gardens"
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri http://localhost:8000/predict -ContentType "application/json" -Body $body | ConvertTo-Json
```

Response:

```json
{
  "predicted_room_type": "Entire home/apt",
  "probabilities": {
    "Entire home/apt": 0.935,
    "Private room": 0.065,
    "Shared room": 0.0
  }
}
```

### Input limits

| Field | Allowed values |
|---|---|
| `latitude` | 40.49 to 40.92 |
| `longitude` | -74.26 to -73.70 |
| `price` | greater than 0, up to 10,000 |
| `minimum_nights` | integer, 1 to 365 |
| `number_of_reviews` | integer, 0 to 1,000 |
| `reviews_per_month` | 0 to 100 |
| `calculated_host_listings_count` | integer, 1 to 1,000 |
| `availability_365` | integer, 0 to 365 |
| `neighbourhood_group` | one of the five boroughs |
| `neighbourhood` | must belong to the chosen borough (see `/options`) |

Invalid input returns `422` with a list of errors:

```json
{
  "detail": [
    {"loc": ["body", "price"], "msg": "Input should be greater than 0", "type": "greater_than"}
  ]
}
```

A failure inside the model returns `500` with `{"detail": "Prediction failed"}`.

## Project structure

```
.
├── backend/
│   ├── .python-version
│   ├── constraints.txt
│   ├── main.py
│   ├── model_pipeline.pkl
│   ├── neighbourhoods.json
│   └── requirements.txt
├── data/
│   ├── .gitkeep
│   └── nyc_data.csv
├── frontend/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── notebooks/
│   ├── model_training.ipynb
│   └── requirements.txt
├── .gitignore
└── README.md
```

`data/nyc_data.csv` is ignored by git and must be downloaded (see [Dataset](#dataset)).
