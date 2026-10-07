// Keyword classes used for head-zone classification.
export const keywordClasses = [
  {
    name: "car",
    verdict: "noise",
    isOverride: true,
    weakHome: true,
    words: [
      "toyota", "mercedes", "bmw", "audi", "nissan", "suzuki", "mitsubishi",
      "hyundai", "kia", "ford", "chevrolet", "volkswagen", "vw", "honda",
      "mazda", "peugeot", "renault", "land", "cruiser", "prado", "hilux",
      "titan", "g63", "v8", "v6", "gxr", "gx", "rav4", "rover", "vitara",
      "camry", "corolla", "motor", "gasolina", "diesel", "matrícula",
      "matricula", "cilindrada", "jantes", "pneus", "carro", "carros",
      "viatura", "veículo", "veiculo", "auto", "moto", "camião", "caminhao",
      "carrinha",
    ],
  },
  {
    name: "phone",
    verdict: "noise",
    isOverride: true,
    weakHome: true,
    words: [
      "iphone", "samsung", "galaxy", "huawei", "xiaomi", "redmi", "tecno",
      "infinix", "itel", "oppo", "vivo", "realme", "pixel", "smartphone",
      "telemóvel", "telefone", "airpods", "fones", "auriculares",
    ],
  },
  {
    name: "electronics",
    verdict: "noise",
    isOverride: true,
    weakHome: true,
    words: [
      "macbook", "laptop", "notebook", "computador", "desktop", "tablet",
      "ipad", "televisão", "televisao", "tv", "playstation", "ps4", "ps5",
      "xbox", "nintendo", "consola", "smartwatch", "monitor", "impressora",
      "processador", "memória", "memoria", "gpu", "placa",
    ],
  },
  {
    name: "furniture",
    verdict: "noise",
    isOverride: true,
    weakHome: true,
    words: [
      "sofá", "sofa", "cama", "mesa", "cadeira", "armário", "armario",
      "roupeiro", "estante", "colchão", "colchao", "geladeira", "frigorífico",
      "frigorifico", "máquina", "maquina", "fogão", "fogao", "microondas",
      "exaustor",
    ],
  },
  {
    name: "services",
    verdict: "noise",
    isOverride: true,
    weakHome: true,
    words: [
      "canalizador", "eletricista", "electricista", "pintor", "pedreiro",
      "carpinteiro", "serralheiro", "mudança", "mudanca", "frete", "detona",
      "desbaratiza", "pragas",
    ],
  },
  {
    name: "home",
    verdict: "",
    isOverride: false,
    weakHome: false,
    words: [
      "casa", "vivenda", "moradia", "apartamento", "apart", "quarto",
      "cozinha", "sala", "wc", "quintal", "varanda", "suite", "suíte", "anexo",
      "escritório", "escritorio", "terreno", "lote", "loja", "armazém",
      "armazem", "quinta", "residencial", "condomínio", "condominio", "prédio",
      "predio", "edifício", "edificio", "andar", "teto", "telhado", "piscina",
      "garagem", "cave", "canalização", "canalizacao", "mosaico", "ladrilhado",
      "kitnet", "flat", "villa",
    ],
  },
];

export const classByName = (name) =>
  keywordClasses.find((c) => c.name === name) || { words: [] };
