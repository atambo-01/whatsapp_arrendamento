"""Predições do modelo sklearn sobre messages.json -> stdout (JSON)."""
import json, sys
sys.path.insert(0, "models")
import classificador_msg as m
m.MODELO = "models/modelo.joblib"
MAP = {"venda": "sale", "arrendamento": "rental", "procura": "seeker", "outro": "noise"}
data = json.load(open(__import__("os").environ.get("EVAL_SET", "test/eval/messages.json")))
out = []
for d in data:
    rot, conf = m.classificar(d["text"])
    out.append({"label": MAP[rot], "conf": round(conf, 3)})
print(json.dumps(out))
