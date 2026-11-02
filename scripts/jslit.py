"""Parse `export default { ... };` files that contain only plain data literals.
Accepts objects, arrays, strings, numbers, true/false/null and comments; rejects anything else."""
import json, re, sys

TOKEN = re.compile(r'''
   (?P<ws>\s+|//[^\n]*|/\*.*?\*/)
 | (?P<str>"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\$]|\\.)*`)
 | (?P<num>-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)
 | (?P<ident>[A-Za-z_$][\w$]*)
 | (?P<punct>[{}\[\]:,])
''', re.S | re.X)

def parse(text):
    text = re.sub(r'^(?:\s+|//[^\n]*|/\*.*?\*/)*', '', text, flags=re.S)  # leading comments
    m = re.match(r'export\s+default\s+', text)
    if not m: raise ValueError('no export default')
    text = text[m.end():].rstrip().rstrip(';')
    toks, pos = [], 0
    while pos < len(text):
        t = TOKEN.match(text, pos)
        if not t: raise ValueError(f'unexpected {text[pos:pos+30]!r}')
        pos = t.end()
        if t.lastgroup != 'ws': toks.append((t.lastgroup, t.group()))
    i = 0
    def val():
        nonlocal i
        kind, s = toks[i]; i += 1
        if s == '{':
            out = {}
            while toks[i][1] != '}':
                k, ks = toks[i]; i += 1
                key = ks if k == 'ident' else str_(ks) if k == 'str' else None
                if key is None or toks[i][1] != ':': raise ValueError('bad key')
                i += 1
                out[key] = val()
                if toks[i][1] == ',': i += 1
            i += 1; return out
        if s == '[':
            out = []
            while toks[i][1] != ']':
                out.append(val())
                if toks[i][1] == ',': i += 1
            i += 1; return out
        if kind == 'str': return str_(s)
        if kind == 'num': return float(s) if '.' in s or 'e' in s.lower() else int(s)
        if s in ('true', 'false', 'null'): return {'true': True, 'false': False, 'null': None}[s]
        raise ValueError(f'not data: {s!r}')
    def str_(s):
        q, body = s[0], s[1:-1]
        if q == '"': return json.loads(s)
        body = body.replace('\\' + q, q).replace('"', '\\"')
        return json.loads('"' + body + '"')
    v = val()
    if i != len(toks): raise ValueError('trailing tokens')
    return v
