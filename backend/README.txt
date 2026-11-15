VELTRIXA backend (pandas + Flask)
  pip install -r backend/requirements.txt
  python backend/app.py            -> open http://127.0.0.1:5000
Edit backend/investigations.csv or backend/sources.csv, then run:
  python backend/build_data.py     (regenerates data.js, the offline fallback)
If the server is not running, the site still works in offline mode (static data.js).
