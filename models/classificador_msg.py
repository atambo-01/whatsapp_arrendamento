"""
Classificador leve de mensagens: venda | arrendamento | procura | outro
Feito para português angolano mal escrito (kasa, vemde, dendo, aluga-se, kz...).

Uso:
    pip install scikit-learn joblib
    python classificador_msg.py treinar            # gera dados sintéticos + treina + guarda modelo.joblib
    python classificador_msg.py treinar dados.csv  # treina com o teu CSV (colunas: texto,rotulo)
    python classificador_msg.py "vendo kasa t3 no kilamba 25 milhoes"

Arquitectura: normalização agressiva -> TF-IDF de caracteres (2-5) + palavras (1-2)
-> Regressão Logística. Modelo final ~1-3 MB, inferência < 1 ms, sem GPU.
"""
import csv
import random
import re
import sys
import unicodedata

import joblib
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report
from sklearn.model_selection import train_test_split
from sklearn.pipeline import FeatureUnion, Pipeline

MODELO = __import__("os").path.join(__import__("os").path.dirname(__file__), "modelo.joblib")
LIMIAR = 0.45  # abaixo disto -> "outro" (evita falsos positivos)

# ---------------------------------------------------------------- normalização
GIRIAS = {
    r"\bk(?=[aouáóú])": "c",       # kasa -> casa, kuanza fica kuanza->cuanza (ok)
    r"\bq\b": "que", r"\bpq\b": "porque", r"\bvc\b": "voce", r"\bblz\b": "beleza",
    r"\bap\b": "apartamento", r"\bapt\b": "apartamento", r"\bvd\b": "vendo",
    r"\bqt\b": "quarto", r"\bwhats(app)?\b": "zap", r"\bwpp\b": "zap",
    r"\bkwanzas?\b": "kz", r"\bkuanzas?\b": "kz", r"\bakz\b": "kz",
    r"\bmilhoes\b": "milhao", r"\bmil\b": "mil",
}


def normalizar(t: str) -> str:
    t = t.lower()
    t = unicodedata.normalize("NFKD", t)
    t = "".join(c for c in t if not unicodedata.combining(c))       # tira acentos
    t = re.sub(r"(.)\1{2,}", r"\1", t)                              # casaaaa -> casa
    t = re.sub(r"(?<=[a-z])0(?=[a-z])", "o", t)                     # vend0 -> vendo
    t = re.sub(r"(?<=[a-z])3(?=[a-z])", "e", t)                     # v3ndo -> vendo
    t = re.sub(r"\d+([.,]\d+)*", " # ", t)                          # números -> #
    t = re.sub(r"[^a-z# ]", " ", t)
    for pad, sub in GIRIAS.items():
        t = re.sub(pad, sub, t)
    return re.sub(r"\s+", " ", t).strip()


# ------------------------------------------------------ dados sintéticos (semente)
# Só IMÓVEIS contam como venda/arrendamento/procura. Venda de carros, telemóveis,
# serviços, aluguer de carros/salões, pedidos vagos ("alguém tem casa?") e conversa
# são "outro". Um anúncio só é anúncio se tiver algum detalhe (tipologia, local, preço).
IMOVEIS = ["casa", "vivenda", "apartamento", "terreno", "moradia", "kitnet", "loja", "armazem",
           "quarto", "escritorio", "anexo", "lote de terreno", "predio", "galpao", "andar", "quinta"]
ARTIGOS = ["carro", "toyota", "hilux", "moto", "telemovel", "iphone", "samsung", "tv", "geladeira",
           "fogao", "sofa", "laptop", "gerador", "bicicleta", "cama", "playstation", "motorizada",
           "camiao", "roupa", "sapatos", "bolos", "cimento", "tijolo", "curso online", "mesa", "ar condicionado"]
SERVICOS = ["canalizador", "electricista", "pedreiro", "pintor", "mudancas", "motorista", "baba", "empregada",
            "cabeleireira", "mecanico", "tecnico de ar condicionado"]
LOCAIS = ["no kilamba", "em talatona", "no benfica", "em viana", "no cazenga", "na maianga",
          "no sambizanga", "em cacuaco", "no golf", "no patriota", "em belas", "na ingombota",
          "no rangel", "no zango", "em luanda", "no lobito", "em benguela", "no huambo", "no camama",
          "no maculusso", "no morro bento", "no cuanza sul", "no sequele", "na samba", "no kikolo"]
PRECOS_ALUG = ["50 mil kz", "150.000 kz", "300 mil", "90 000 kwanzas", "250k", "80000kz", "120 mil por mes",
               "800 usd", "1200 dolares", "200.000 kz mensal", "70 mil kz"]
PRECOS_VENDA = ["2 milhoes", "35 milhoes", "5 milhoes de kz", "18 milhoes kz", "120 milhoes", "9 milhoes", "40 milhoes de kz"]
PRECOS_OBJ = ["50 mil kz", "150.000 kz", "450 mil", "20 mil", "1 milhao", "350k", "18 milhoes", "800 mil kz", "120 mil"]
TAMANHOS = ["t1", "t2", "t3", "t4", "v3", "v4", "2 quartos", "3 quartos", "1 quarto", "com quintal",
            "com agua e luz", "mobilado", "com casa de banho", "com suite", "com garagem", "com piscina", "duplex"]
CONTACTOS = ["contacto 923 456 789", "ligar 912345678", "tratar 931222333", "zap 923000111", "inbox",
             "chama no zap 944555666", "contacto: 925 111 222", "tel 927888999"]
CABECALHO = ["", "", "bom dia ", "boa tarde ", "boa noite pessoal ", "atencao ", "disponivel ", "urgente "]
VERBOS = {
    "arrendamento": ["arrenda-se", "aluga-se", "arrendo", "alugo", "tenho para arrendar", "para alugar",
                     "disponivel para arrendamento", "arrendamos", "aluga se", "temos para arrendar"],
    "venda": ["vende-se", "vendo", "a venda", "esta a venda", "tenho para vender", "venda de", "vendemos",
              "vendo urgente", "vende se"],
    "procura": ["procuro", "preciso de", "procuramos", "estou a procura de", "quero comprar",
                "quero arrendar", "precisamos de", "procura-se", "preciso arrendar", "busco"],
}


def _detalhes(rot, forcar=None):
    """Devolve (tamanho, local, preco, contacto); `forcar` = n.º de detalhes concretos desejado."""
    precos = PRECOS_VENDA if rot == "venda" else PRECOS_ALUG
    pool = [random.choice(TAMANHOS), random.choice(LOCAIS), random.choice(precos)]
    n = forcar if forcar is not None else random.choice([1, 2, 2, 3, 3])
    keep = set(random.sample(range(3), n))
    t, l, p = [pool[i] if i in keep else "" for i in range(3)]
    return t, l, p, (random.choice(CONTACTOS) if random.random() < 0.5 else "")


def _anuncio(rot, com_detalhes=True):
    verbo = random.choice(VERBOS[rot])
    coisa = random.choice(IMOVEIS)
    t, l, p, c = _detalhes(rot, None if com_detalhes else 0)
    cab = random.choice(CABECALHO)
    estilo = random.random()
    if estilo < 0.3:  # multi-linha estilo anúncio
        linhas = [f"{verbo} {coisa}", t, l, ("renda " if rot == "arrendamento" else "preco ") + p if p else "", c]
        txt = cab + "\n".join(x for x in linhas if x.strip())
    else:
        txt = f"{cab}{verbo} {coisa} {t} {l} {p} {c}"
    return re.sub(r"[ ]+", " ", txt).strip(), (t or l or p) != ""


PROCURA_FRASES = [
    "procuro {c} {t} para arrendar {l} ate {p}", "alguem tem {c} {t} para alugar {l} ate {p}",
    "quem tem {c} {t} para alugar {l} ate {p}", "alguem sabe de {c} {t} para arrendar {l} {p}",
    "preciso de {c} {t} para arrendar {l} orcamento {p}", "quero comprar {c} {t} {l} ate {p} alguem vende",
    "procuro {c} para comprar {l} ate {p}", "preciso arrendar {c} {l} {p} urgente",
    "estou a procura de {c} {t} para alugar {l} orcamento {p}", "alguem com {c} {t} para arrendar {l} ate {p}",
    "bom dia procuro {c} {t} {l} ate {p} contacto 923000111", "procuramos {c} {t} para alugar ate {p} {l}",
    "alguem conhece {c} {t} para arrendar {l}", "quem arranja {c} {t} {l} ate {p}",
]


def _procura_rica():
    c = random.choice(IMOVEIS[:8])
    frase = random.choice(PROCURA_FRASES)
    comprar = "comprar" in frase
    p = random.choice(PRECOS_VENDA if comprar else PRECOS_ALUG)
    t, l = random.choice(TAMANHOS), random.choice(LOCAIS)
    keep = random.sample(["t", "l", "p"], random.choice([1, 2, 3]))
    return frase.format(c=c, t=t if "t" in keep else "", l=l if "l" in keep else "", p=p if "p" in keep else "")


def _sem_intencao():
    """T2 no zango 120000kz ligar ...: tipologia + preço + contacto/zona, sem verbo."""
    t = random.choice(TAMANHOS[:6])
    venda = random.random() < 0.3
    return f"{random.choice(['', 'casa ', 'apartamento '])}{t} {random.choice(LOCAIS)} {random.choice(PRECOS_VENDA if venda else PRECOS_ALUG)} {random.choice(CONTACTOS)}", "venda" if venda else "arrendamento"


OUTRO_FIXO = [
    "bom dia a todos", "boa tarde pessoal", "obrigado pela ajuda", "alguem viu o jogo ontem", "feliz aniversario mano",
    "como estao todos", "reuniao amanha as 9h", "quem vai ao culto domingo", "o transito ta complicado hoje",
    "estou a caminho", "podem me ligar", "recebi o pagamento obrigado", "bue de fixe a festa", "parabens pela conquista",
    "a que horas chega o voo", "ta tudo bem contigo", "vamos marcar o churrasco", "deus abencoe a todos",
    "alguem sabe a que horas abre o banco", "chega la em casa mais tarde", "nao esquecam da reuniao do condominio",
    "quanto custa o bilhete de aviao", "o preco do combustivel subiu", "ja paguei a renda ontem",
    "o meu carro avariou hoje cedo", "vi uma casa bonita no kilamba ontem", "a minha vivenda tem muita agua",
    "gosto de apartamentos grandes", "a minha casa foi arrombada ontem cuidado com os ladroes",
    "o aluguer esta caro este mes", "os alugueres subiram muito em luanda", "a renda do meu t2 aumentou",
    "cuidado com burlas de arrendamento nao paguem caucao antes de ver a casa",
    "regras do grupo proibido vender carros telemoveis so imoveis", "este grupo e so para anuncios de casas respeitem",
    "alguem tem o contacto de um agente imobiliario", "estou a pensar comprar casa para o ano alguem tem dicas",
    "quanto custa um apartamento t3 em luanda", "quem sabe quanto custa arrendar uma casa no talatona",
    "obrigado ja consegui casa", "ja arrendei podem retirar o anuncio", "a casa ja foi vendida obrigado",
    "atencao a casa que anunciei ja esta alugada", "amanha vamos ver a casa as 10h", "estou a caminho da casa chego em 10 minutos",
    "o dono da casa pediu mais caucao sera normal", "mudei de casa hoje cansado", "a casa do vizinho pegou fogo",
    "t2 e pequeno t3 e melhor", "casa no campo e bom demais", "ok", "kkkkk", "sim", "nao", "pode ser", "combinado",
    "quem tem t2 ai manda no privado", "bom dia quem tem casa ai", "alguem tem casa", "preciso de uma casa", "aluga-se casa",
    "vende-se casa", "procuro casa", "arrendo casa", "alguem sabe de casa", "quem tem quarto",
    "casa de apostas bonus no primeiro deposito", "ganhe dinheiro em casa inscreva-se ja", "curso de ingles matriculas abertas",
    "pastor convida para o culto de domingo", "vaga para vendedor enviar cv", "procuro emprego tenho experiencia",
]


def _ruido(t: str) -> str:
    """Simula escrita descuidada: typos, k por c, sem acento, letras repetidas, MAIÚSCULAS."""
    r = random.random()
    if r < 0.25:
        t = t.replace("c", "k").replace("qu", "k")
    if random.random() < 0.3 and len(t) > 6:                # apaga letra
        i = random.randrange(1, len(t) - 1)
        t = t[:i] + t[i + 1:]
    if random.random() < 0.25 and len(t) > 6:               # troca letras vizinhas
        i = random.randrange(1, len(t) - 2)
        t = t[:i] + t[i + 1] + t[i] + t[i + 2:]
    if random.random() < 0.2:
        t = re.sub(r"([aeiou])", lambda m: m.group(1) * random.choice([1, 1, 3]), t, count=1)
    if random.random() < 0.15:
        t = t.upper()
    for a, b in [("vend", "dend"), ("vend", "vemd"), ("arrend", "arend"), ("alug", "aluk"), ("procur", "prokuro")]:
        if random.random() < 0.08:
            t = t.replace(a, b)
    return t


def gerar_dados(n_por_classe=1500, seed=42):
    random.seed(seed)
    linhas = []
    # Positivos: intenção + imóvel + detalhe concreto
    for rot in ["venda", "arrendamento", "procura"]:
        for _ in range(n_por_classe):
            txt, tem = _anuncio(rot, com_detalhes=random.random() < 0.85)
            linhas.append((_ruido(txt), rot if tem else "outro"))
    for _ in range(n_por_classe):
        linhas.append((_ruido(_procura_rica()), "procura"))
    for _ in range(n_por_classe // 8):
        txt, rot = _sem_intencao()
        linhas.append((_ruido(txt), rot))
    # Negativos duros: o mesmo verbo com artigos / serviços / aluguer de coisas que não são casas
    for _ in range(n_por_classe):
        k = random.random()
        c = random.choice(ARTIGOS)
        if k < 0.30:
            txt = f"{random.choice(CABECALHO)}{random.choice(VERBOS['venda'])} {c} {random.choice(PRECOS_OBJ)} {random.choice(CONTACTOS)} {random.choice(LOCAIS)}"
        elif k < 0.50:
            txt = f"{random.choice(['procuro', 'preciso de', 'alguem tem', 'alguem vende', 'quem tem', 'procuramos'])} {c} {random.choice(['', 'usado', 'novo', 'barato'])} {random.choice(['', 'ate ' + random.choice(PRECOS_OBJ)])}"
        elif k < 0.65:
            txt = f"{random.choice(['preciso de', 'procuro', 'quem tem contacto de', 'alguem conhece'])} {random.choice(SERVICOS)} {random.choice(LOCAIS)}"
        elif k < 0.80:
            txt = f"aluguer de {random.choice(['carros', 'salao de festas', 'equipamentos de som', 'cadeiras e mesas', 'camioes', 'geradores'])} {random.choice(LOCAIS)} {random.choice(PRECOS_OBJ)} por dia {random.choice(CONTACTOS)}"
        elif k < 0.90:
            txt = random.choice(["alguem tem", "quem sabe de", "alguem conhece", "preciso de"]) + " " + random.choice(IMOVEIS) + random.choice(["", "?", " por ai?"])
        else:
            txt = f"{random.choice(['quanto custa', 'qual o preco de'])} {random.choice(['arrendar', 'comprar', 'um', 'alugar'])} {random.choice(IMOVEIS)} {random.choice(LOCAIS)}"
        linhas.append((_ruido(txt), "outro"))
    for _ in range(n_por_classe):
        linhas.append((_ruido(random.choice(OUTRO_FIXO)), "outro"))
    random.shuffle(linhas)
    return linhas


# ---------------------------------------------------------------------- modelo
def construir():
    feats = FeatureUnion([
        ("car", TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 5), min_df=2,
                                sublinear_tf=True, max_features=80000)),
        ("pal", TfidfVectorizer(analyzer="word", ngram_range=(1, 2), min_df=1, sublinear_tf=True)),
    ])
    return Pipeline([
        ("tfidf", feats),
        ("clf", LogisticRegression(C=8, max_iter=2000, class_weight="balanced")),
    ])


def treinar(csv_path=None):
    if csv_path:
        with open(csv_path, encoding="utf-8") as f:
            linhas = [(r["texto"], r["rotulo"]) for r in csv.DictReader(f)]
    else:
        linhas = gerar_dados()
    X = [normalizar(t) for t, _ in linhas]
    y = [r for _, r in linhas]
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, stratify=y, random_state=1)
    modelo = construir().fit(Xtr, ytr)
    print(classification_report(yte, modelo.predict(Xte), digits=3))
    modelo.fit(X, y)  # treino final com tudo
    joblib.dump(modelo, MODELO, compress=3)
    print(f"Modelo guardado em {MODELO}")


_cache = None


def classificar(texto: str):
    """Devolve (rotulo, confianca). Se confianca < LIMIAR -> 'outro'."""
    global _cache
    if _cache is None:
        _cache = joblib.load(MODELO)
    p = _cache.predict_proba([normalizar(texto)])[0]
    i = p.argmax()
    rot, conf = _cache.classes_[i], float(p[i])
    return ("outro", conf) if conf < LIMIAR else (rot, conf)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "treinar":
        treinar(sys.argv[2] if len(sys.argv) > 2 else None)
    elif len(sys.argv) > 1:
        print(classificar(" ".join(sys.argv[1:])))
    else:
        print(__doc__)
