"""Exporta modelo.joblib para src/parser/model.json (inferência em JS puro, sem Python)."""
import json, os, sys
import joblib
here = os.path.dirname(os.path.abspath(__file__))
pipe = joblib.load(os.path.join(here, "modelo.joblib"))
union = pipe.named_steps["tfidf"]
clf = pipe.named_steps["clf"]
out = {"classes": list(clf.classes_), "intercept": [round(float(x), 6) for x in clf.intercept_], "vectorizers": []}
offset = 0
for name, vec in union.transformer_list:
    vocab = {t: int(i) for t, i in vec.vocabulary_.items()}
    out["vectorizers"].append({
        "name": name, "analyzer": vec.analyzer, "ngram": list(vec.ngram_range), "offset": offset,
        "idf": [round(float(x), 6) for x in vec.idf_], "vocab": vocab,
    })
    offset += len(vocab)
# coef[class][feature], rounded; stored per class
out["coef"] = [[round(float(x), 5) for x in row] for row in clf.coef_]
dest = os.path.join(here, "..", "src", "parser", "model.json")
json.dump(out, open(dest, "w"), ensure_ascii=False, separators=(",", ":"))
print("features:", offset, "bytes:", os.path.getsize(dest))
