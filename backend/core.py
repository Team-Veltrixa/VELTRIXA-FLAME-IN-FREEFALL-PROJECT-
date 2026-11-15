"""VELTRIXA analysis core (pandas). Single source of truth: investigations.csv + sources.csv."""
import re
from pathlib import Path
import pandas as pd

HERE = Path(__file__).parent
HABITATS = {'iss': 'Spacecraft / ISS', 'lunar': 'Lunar base', 'mars': 'Mars base', 'rover': 'Pressurized rover'}
GOALS = {'all': 'All goals', 'habitat': 'Habitat safety', 'model': 'Modeling data', 'controls': 'Next-gen controls'}
ENVS = {'earth-air': 'Earth air', 'artemis-moon': 'Artemis Moon base', 'pure-oxygen': 'Pure oxygen'}
O2_BOOST = {'earth-air': 0, 'artemis-moon': 3, 'pure-oxygen': 5}
SPLIT_COLS = ['goals', 'keys', 'topics', 'source_ids']


def load_sources() -> pd.DataFrame:
    """Harvard referencing: Author (Year[a]) Title. Available at: URL (Accessed: date)."""
    src = pd.read_csv(HERE / 'sources.csv', dtype=str).fillna('')
    src['year'] = src['year'].replace('', 'n.d.')
    src['verified'] = src['verified'].str.lower().eq('true')
    src['_y'] = src['year'].map(lambda y: 9999 if y == 'n.d.' else int(y))
    src = src.sort_values(['author', '_y', 'title']).reset_index(drop=True)
    n_same = src.groupby(['author', 'year'])['id'].transform('size')
    idx = src.groupby(['author', 'year']).cumcount()
    src['suffix'] = [chr(97 + i) if n > 1 else '' for i, n in zip(idx, n_same)]
    src['intext'] = src['author'] + ', ' + src['year'] + src['suffix']
    acc = src.apply(lambda r: r['accessed'] or '[date to confirm]', axis=1)
    src['ref_text'] = src['author'] + ' (' + src['year'] + src['suffix'] + ') ' + src['title'] + '. Available at: ' + src['url'] + ' (Accessed: ' + acc + ').'
    src['ref_html'] = src['author'] + ' (' + src['year'] + src['suffix'] + ') <em>' + src['title'] + '</em>. Available at: <a href="' + src['url'] + '" target="_blank" rel="noopener noreferrer">' + src['url'] + '</a> (Accessed: ' + acc + ').'
    return src.drop(columns='_y')


def load():
    inv = pd.read_csv(HERE / 'investigations.csv', dtype=str).fillna('')
    for c in ['rel_iss', 'rel_lunar', 'rel_mars', 'rel_rover']:
        inv[c] = inv[c].astype(int)
    inv['o2'] = inv['o2'].str.lower().eq('true')
    for c in SPLIT_COLS:
        inv[c] = inv[c].apply(lambda s: [x.strip() for x in s.split(';') if x.strip()])
    src = load_sources()
    lab = src.set_index('id')['intext']
    inv['cite'] = inv['source_ids'].apply(lambda ids: '(' + '; '.join(lab[i] for i in ids) + ')')
    inv['url'] = inv['source_ids'].apply(lambda ids: src.set_index('id').loc[ids[0], 'url'])
    return inv, src


INV, SRC = load()


def score(habitat='lunar', goal='all', env='artemis-moon') -> pd.DataFrame:
    """Transparent score = habitat relevance (1-5 x4) + goal match + O2 boost."""
    df = INV.copy()
    df['habitat_pts'] = df['rel_' + habitat] * 4
    df['goal_pts'] = df['goals'].apply(lambda g: len(g) * 2 if goal == 'all' else (6 if goal in g else 0))
    df['o2_pts'] = df['o2'].astype(int) * O2_BOOST[env]
    df['score'] = df[['habitat_pts', 'goal_pts', 'o2_pts']].sum(axis=1)
    df = df.sort_values(['score', 'name'], ascending=[False, True]).reset_index(drop=True)
    df['rank'] = df.index + 1
    return df


def collection_summary() -> str:
    by_goal = INV.explode('goals').groupby('goals').size()
    by_cat = INV.groupby('category').size().sort_values(ascending=False)
    ground = int((INV['platform'] == 'Ground').sum())
    cats = ', '.join(f'{n} {c}' for c, n in by_cat.items())
    return (f'The dataset covers {len(INV)} NASA PSI combustion investigations ({cats}); {ground} is ground-based. '
            f'Tagged goals: {by_goal.get("habitat", 0)} for habitat safety, {by_goal.get("model", 0)} for modeling data, '
            f'{by_goal.get("controls", 0)} for next-gen controls. ' + cite_ids(['psi', 'roses']))


def interpret(df: pd.DataFrame, habitat: str, goal: str, env: str) -> str:
    """Rule-based interpretation computed from the ranked DataFrame."""
    top = df.head(5)
    names = ', '.join(top.head(3)['name'])
    out = [f'For a {HABITATS[habitat].lower()} ({GOALS[goal].lower()}, {ENVS[env]}), the strongest evidence comes from {names}.']
    n_sc = int((top['category'] == 'spacecraft').sum())
    if n_sc >= 2:
        out.append(f'{n_sc} of the top 5 are spacecraft-scale SAFFIRE tests, the closest analogue to a real cabin fire.')
    if env != 'earth-air' and top['o2'].mean() >= 0.6:
        out.append(f'{int(top["o2"].sum())} of the top 5 are oxygen-sensitive, which matters because this environment is oxygen-enriched.')
    g = INV.explode('goals').groupby('goals').size()
    gap = g.idxmin()
    out.append(f'Evidence gap in this dataset: only {int(g.min())} investigations are tagged for "{GOALS[gap]}".')
    if (INV['platform'] == 'Ground').any():
        out.append('Ground-based studies rank lower because they lack microgravity conditions.')
    return ' '.join(out)


def cite_ids(ids) -> str:
    lab = SRC.set_index('id')['intext']
    return '(' + '; '.join(lab[i] for i in ids) + ')'


def refs_for(source_ids):
    s = SRC[SRC['id'].isin(source_ids)]
    return s['ref_text'].tolist()


def _row_text(r) -> str:
    basis = '' if r['basis'] == 'nasa-text' else ' (Summary is the team\'s paraphrase of the PSI listing title.)'
    return (f"{r['name']} ({r['platform']}): {r['summary']} Fire-safety takeaway: {r['insight']} "
            f"Earth application: {r['earth']} {r['cite']}{basis}")


def _hits(q: str) -> pd.DataFrame:
    ok = lambda ks: any(re.search(r'\b' + re.escape(k) + r'\b', q) for k in ks)
    h = INV[INV['keys'].apply(ok)]
    return h if len(h) else INV[INV['topics'].apply(ok)]


def chat(message: str, habitat='lunar', goal='all', env='artemis-moon') -> dict:
    q = message.lower()
    df = score(habitat, goal, env)
    ids = []
    hits = _hits(q)
    named = df[df['name'].str.lower().apply(lambda n: n in q)]
    if len(named):
        low = named['name'].str.lower().tolist()
        named = named[[not any(n != m and n in m for m in low) for n in low]]

    if len(named) >= 2 or (len(hits) >= 2 and re.search(r'compar|versus|\bvs\b', q)):
        cmp_ = (named if len(named) >= 2 else df[df['id'].isin(hits['id'])]).head(4)
        lines = [f"{r['name']}: rank #{r['rank']}, score {r['score']} (habitat {r['habitat_pts']} + goal {r['goal_pts']} + O2 {r['o2_pts']}). {r['insight']} {r['cite']}" for _, r in cmp_.iterrows()]
        best = cmp_.iloc[0]
        answer = f'Comparison for {HABITATS[habitat].lower()} / {GOALS[goal].lower()}:\n' + '\n'.join(lines) + f'\n{best["name"]} ranks highest in this context.'
        ids = sorted({i for l in cmp_['source_ids'] for i in l})
    elif len(hits) >= 1:
        if len(named):
            pick = named.assign(n=named['name'].str.len()).sort_values('n', ascending=False).iloc[0]
            ctx = df[df['id'] == pick['id']].iloc[0]
            answer = _row_text(pick) + f" In this context ({HABITATS[habitat]}, {GOALS[goal]}, {ENVS[env]}) it ranks #{ctx['rank']} of {len(df)} with score {ctx['score']}."
            ids = pick['source_ids']
        elif len(hits) == 1:
            pick = hits.iloc[0]
            ctx = df[df['id'] == pick['id']].iloc[0]
            answer = _row_text(pick) + f" Current rank: #{ctx['rank']} (score {ctx['score']})."
            ids = pick['source_ids']
        else:
            sub = df[df['id'].isin(hits['id'])]
            answer = f'{len(sub)} related investigations, best-ranked first: ' + ' | '.join(f"#{r['rank']} {r['name']}: {r['summary']} {r['cite']}" for _, r in sub.iterrows())
            ids = sorted({i for l in sub['source_ids'] for i in l})
    elif re.search(r'summar|overview|collection|how many', q):
        answer = collection_summary(); ids = ['psi', 'roses']
    elif re.search(r'\b(rank|top|best|matter|relevant|lunar|moon|mars|rover)\b', q):
        h = 'mars' if 'mars' in q else 'rover' if 'rover' in q else 'lunar' if re.search(r'lunar|moon', q) else habitat
        d2 = score(h, goal, env)
        top = d2.head(3)
        answer = f'Top picks for {HABITATS[h].lower()} ({GOALS[goal].lower()}): ' + ', '.join(f"{r['rank']}. {r['name']} (score {r['score']}) {r['cite']}" for _, r in top.iterrows()) + '\n' + interpret(d2, h, goal, env)
        ids = sorted({i for l in top['source_ids'] for i in l})
    elif re.search(r'smoke|detector|aerosol', q):
        sub = df[df['category'] == 'smoke']
        answer = 'Smoke and aerosol sensing: ' + ' '.join(_row_text(r) for _, r in sub.iterrows()); ids = sorted({i for l in sub['source_ids'] for i in l})
    elif re.search(r'extinguish|suppress|equipment|control|mist', q):
        sub = df[df['goals'].apply(lambda g: 'controls' in g)]
        answer = 'Investigations informing next-generation controls and equipment (best-ranked first): ' + ', '.join(f"{r['name']} {r['cite']}" for _, r in sub.iterrows()) + '. Fine-water-mist extinguishers from the ISS also have Earth applications.'
        ids = sorted({i for l in sub['source_ids'] for i in l})
    elif re.search(r'model|predict|data|simulat', q):
        sub = df[df['goals'].apply(lambda g: 'model' in g)]
        answer = 'Investigations supporting predictive flammability and fire modeling (best-ranked first): ' + ', '.join(f"{r['name']} {r['cite']}" for _, r in sub.iterrows()) + '. Use Export in the ranking panel to download the table.'
        ids = sorted({i for l in sub['source_ids'] for i in l})
    elif re.search(r'earth|spinoff|firefighter|terrestrial', q):
        sub = df.drop_duplicates('earth').head(5)
        answer = 'Earth applications: ' + ' | '.join(f"{r['name']}: {r['earth']} {r['cite']}" for _, r in sub.iterrows()) + '. NASA technology has also improved firefighter protective clothing and air tanks.'
        ids = sorted({i for l in sub['source_ids'] for i in l}) + ['spinoff']
    else:
        return {'answer': 'No match in the PSI dataset. Try an investigation name (ACME, BASS-II, FLEX, SAFFIRE, SAME, DAFT, CFI), "compare BASS-II and SAFFIRE-I", "summarize the collection", or ask which investigations matter most for a lunar base.', 'refs': [], 'engine': 'pandas'}

    refs = refs_for(ids)
    if refs:
        answer += '\n\nReferences:\n' + '\n'.join(refs)
    return {'answer': answer, 'refs': refs, 'engine': 'pandas'}
