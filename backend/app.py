"""VELTRIXA server: serves the site and a pandas-powered API.  Run:  python backend/app.py"""
from pathlib import Path
from flask import Flask, jsonify, request, send_from_directory, abort
import core

ROOT = Path(__file__).resolve().parent.parent
ALLOWED = {'.html', '.css', '.js', '.png', '.webp', '.svg', '.jpg', '.jpeg', '.mp4', '.ico'}
app = Flask(__name__)


def ctx(src):
    h = src.get('habitat', 'lunar'); g = src.get('goal', 'all'); e = src.get('env', 'artemis-moon')
    return (h if h in core.HABITATS else 'lunar', g if g in core.GOALS else 'all', e if e in core.ENVS else 'artemis-moon')


@app.get('/api/rank')
def api_rank():
    h, g, e = ctx(request.args)
    df = core.score(h, g, e)
    cols = ['rank', 'id', 'name', 'platform', 'category', 'score', 'habitat_pts', 'goal_pts', 'o2_pts', 'insight', 'earth', 'cite', 'url']
    return jsonify(rows=df[cols].to_dict('records'), interpretation=core.interpret(df, h, g, e), summary=core.collection_summary())


@app.post('/api/chat')
def api_chat():
    body = request.get_json(silent=True) or {}
    msg = str(body.get('message', ''))[:500].strip()
    if not msg:
        return jsonify(error='empty message'), 400
    h, g, e = ctx(body)
    return jsonify(core.chat(msg, h, g, e))


@app.get('/api/sources')
def api_sources():
    return jsonify(core.SRC[['id', 'intext', 'ref_text', 'verified']].to_dict('records'))


@app.get('/')
def home():
    return send_from_directory(ROOT, 'index.html')


@app.get('/<path:p>')
def static_files(p):
    if Path(p).suffix.lower() not in ALLOWED or '..' in p:
        abort(404)
    return send_from_directory(ROOT, p)


if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000, debug=False)
