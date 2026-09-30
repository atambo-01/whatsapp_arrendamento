package main

import (
	"regexp"
	"strconv"
	"strings"

	"github.com/agnivade/levenshtein"
)

type Listing struct {
	MsgID       string
	ChatName    string
	ChatJID     string
	Sender      string
	SenderJID   string
	Timestamp   string
	Title       string
	Typology    string
	Price       int
	PriceText   string
	PriceOk     int
	Location    string
	LocationRaw string
	Phone       string
	RawText     string
	Category    string
}

// Rental price range (Kz / month). Outside → flagged, not hidden.
const (
	RentalMin = 15000
	RentalMax = 700000
	SaleMin   = 1000000
	SaleMax   = 50000000
)

var (
	reRentalStrong = regexp.MustCompile(`(?i)(` +
		`arrenda[\s\-]?se|arrendam[\s\-]?se|` +
		`aluga[\s\-]?se|alugam[\s\-]?se|` +
		`\barrendo\b|\barrendam\b|` +
		`\balugo\b|\balugam\b|` +
		`\baluguei\b|\barrendei\b|` +
		`\balugando\b|\barrendando\b|` +
		`\bestou a alugar\b|\bestou alugando\b|` +
		`\bestou a arrendar\b|\bestou arrendando\b|` +
		`\bestamos a alugar\b|\bestamos alugando\b|` +
		`\btemos para alugar\b|\btemos para arrendar\b|` +
		`\bpara aluguer\b|\bpara aluguel\b|` +
		`\bpara arrendar\b|\bpara arrendamento\b|` +
		`\bem arrendamento\b|\bem aluguer\b|` +
		`\barrendamento\b|\baluguer\b|\baluguel\b` +
		`)`)

	reRentalWeak = regexp.MustCompile(`(?i)(` +
		`\barrenda\b|\barrendas\b|\barrendar\b|` +
		`\baluga\b|\balugas\b|\balugar\b` +
		`)`)

	reSeekerVerb = regexp.MustCompile(`(?i)(` +
		`\bprocuro\b|\bprocuramos\b|\bprocurando\b|\bprocura[\s\-]?se\b|` +
		`\bestou (à|a|em)? ?procura\b|\bando (à|a)? ?procura\b|` +
		`\bestou a procurar\b|\bestou procurando\b|` +
		`\bpreciso (de|duma|dum|duns|dumas)\b|\bprecisamos (de|duma|dum)\b|` +
		`\bquero (uma|um|uns|umas)\b|\bqueremos (uma|um)\b|` +
		`\balgu[eé]m tem\b|\balgu[eé]m sabe\b|\balgu[eé]m arranja\b|\balgu[eé]m conhece\b|` +
		`\bquem tem\b|\bquem sabe\b|\bquem arranja\b|\bquem conhece\b|` +
		`\barranja[\s\-]?se\b|\barranjem\b|` +
		`\bnecessito (de|duma|dum)\b|\bnecessitamos (de|duma|dum)\b|` +
		`\btou à procura\b|\btou a procura\b|` +
		`\bsolicito\b|\bsolicitaç` +
		`)`)

	reSaleStrong = regexp.MustCompile(`(?i)(` +
		`\bvende[\s\-]?se\b|\bvendem[\s\-]?se\b|` +
		`\bvendo\b|\bvendemos\b|` +
		`à venda|para venda|` +
		`está à venda|está para vender|` +
		`\bvenda de\b|\bem venda\b|` +
		`\bquero vender\b|\bpretendo vender\b|` +
		`\bvenda urgente\b|` +
		`\bem construção\b` +
		`)`)

	reSaleWeak = regexp.MustCompile(`(?i)(` +
		`\bvender\b|\bvende\b|\bvendes\b` +
		`)`)

	reCar = regexp.MustCompile(`(?i)(` +
		`mercedes|land\s?cruiser|nissan|suzuki|toyota|hilux|titan|` +
		`grand\s?vitara|prado|rav4|range\s?rover|bmw|audi|` +
		`\bv8\b|\bv6\b|\bg63\b|\bgxr?\b|\bgx\b|` +
		`motor\s+(selado|avariado|seco)|caixa\s+autom|` +
		`combust[íi]vel|gasolina|diesel|matr[íi]cula|` +
		`quil[oó]metros?|kms?\s*\d|` +
		`carro[s]?\b|ve[íi]culo|viatura` +
		`)`)

	reTypology = regexp.MustCompile(`(?i)\b(` +
		`T[\s\-]?[0-9]|V[\s\-]?[0-9]|` +
		`duplex|triplex|` +
		`apartamento|apart|apº|ap\.|apto|` +
		`vivenda|moradia|villa|` +
		`quarto|kitnet|kit[\s\-]?net|flat|studio|estúdio|` +
		`loja|armazém|armazem|escritório|escritorio|` +
		`terreno|lote|quinta|` +
		`residencial|casa` +
		`)\b`)

	// Currency-suffixed price. Handles "50 mil", "450 kz",
	// "45.000.000,00 Kz", "100 'MIL", "250k", "300M", "1 milhão".
	rePriceK = regexp.MustCompile(`(?i)` +
		`(\d{1,3}(?:[.,\s]\d{3})+|\d+)` +
		`(?:[.,]\d{1,2})?` +
		`\s*['\x60]?\s*` +
		`(milh(?:ão|ões|ao|oes)|mil|kzs?|k\b|akz|aoa|usd|\$|m\b)`)

	// Leading-marker price. Handles "preço: 45", "renda 230 mil",
	// "mensalidade 45", "plafon 250k", "plafond 300M".
	rePriceNum = regexp.MustCompile(`(?i)` +
		`(?:plafond|plafon|pre[çc]o|valor|renda|mensalidade|por m[êe]s|mensal)\s*[:\-]?\s*` +
		`(\d{1,3}(?:[.,\s]\d{3})*|\d+)` +
		`(?:[.,]\d{1,2})?` +
		`\s*(milh(?:ão|ões|ao|oes)|mil|kzs?|k\b|akz|aoa|usd|\$|m\b)?`)

	rePhone = regexp.MustCompile(`\b(?:9\d{2}[\s\-]?\d{3}[\s\-]?\d{3}|9\d{8})\b`)

	reSpam = regexp.MustCompile(`(?i)(kwanzabet|shopee\.com\.br|chat vip|affiliates/?btag|wa\.me/message|bet\s?\d|cassino|aposta|desbaratiza|detona)`)

	reMedia = regexp.MustCompile(`^(sent (image|video|audio|sticker|document)|\(message\)|image|video|audio)$`)

	reWord = regexp.MustCompile(`[A-Za-zÀ-ÿ0-9]+`)
)

var locationMarkers = []string{
	"📍 localização", "📍 localizacao", "📍",
	"localização", "localizacao", "localizado em", "localizado no", "localizado na",
	"local", "loc:", "loc.",
	"gps", "endereço", "endereco", "morada",
	"situado em", "situado no", "situado na", "situada em", "situada no", "situada na",
	"zona", "bairro", "rua", "avenida", "av.",
	"referência", "referencia", "ponto de referência", "ponto de referencia",
	"junto ao", "junto à", "junto a", "ao lado de", "ao lado do", "ao lado da",
	"por trás de", "por trás do", "por trás da", "atrás de", "atrás do", "atrás da",
	"próximo de", "próximo do", "próximo da", "perto de", "perto do", "perto da",
	"nas mediações de", "nas mediações do", "nas mediações da",
	"nas imediações de", "nas imediações do", "nas imediações da",
	"defronte a", "defronte ao", "defronte à", "em frente a", "em frente ao", "em frente à",
}

var knownLocations = []string{
	"Talatona", "Belas", "Cacuaco", "Cazenga", "Viana", "Kilamba Kiaxi",
	"Kilamba", "Icolo e Bengo", "Quissama", "Mussulo", "Ingombota",
	"Maianga", "Rangel", "Samba", "Sambizanga", "Hoji ya Henda",
	"Camama", "Morro Bento", "Nova Vida", "Golf 2", "Golfo 2", "Golfe 2",
	"Golf 1", "Golfe 1", "Zango", "Luanda Sul", "Patriota", "Lar do Patriota",
	"Benfica", "Rocha Pinto", "Rocha", "Fubu", "Gamek", "Soba Kapassa",
	"Capolo", "Petrangol", "Palanca", "Calemba", "Calemba 2", "Mufulama", "Cassenda",
	"Prenda", "Futungo", "Futungo de Belas", "Corimba", "Ilha de Luanda",
	"Ilha do Cabo", "Tala Hady", "Tala-Alice", "Kimbango", "Kikuxi",
	"Bairro Popular", "Bairro Militar", "Bairro Azul", "Bairro das Tendas",
	"Terra Nova", "Dangereux", "Vila Flor", "Vila Alice", "Jango", "Sapu",
	"Quinguele", "Sagrada Esperança", "Zamba", "Cassequel", "Ngola Kiluanje",
	"Catambor", "Cuca", "Mártires do Kifangondo", "Mártires de Kifangondo",
	"Vila Estoril", "Morro da Luz", "Kikolo", "Cabolombo", "Ramiros",
	"São Paulo", "Mabor", "Panguila", "Sequele", "Kima Kieza",
	"Vila Verde", "Quenguela", "Morro dos Veados",
	"Zango 0", "Zango 1", "Zango 2", "Zango 3", "Zango 4", "Zango 5",
	"Camama 1", "Camama 2", "Camama 3", "Camama 4",
	"Calemba 2",
	"Angomart", "Kero", "Xyami", "Belas Shopping", "Fortaleza",
	"Cidadela", "Aeroporto", "Porto de Luanda", "Marginal", "Miramar",
	"Alvalade", "Maculusso", "Mutamba", "Coqueiros", "Chicala",
	"Bairro Operário", "Quinanga", "Margal", "Estalagem",
}

var numberedBases = []string{"golf", "golfe", "golfo", "zango", "camama", "calemba"}

// applyMultiplier applies the currency-suffix multiplier.
// Guard: if suffix is "mil"/"k" and base number already >= 10000, assume
// the poster wrote the full number and the suffix is redundant.
func applyMultiplier(n int, unit string) int {
	u := strings.ToLower(strings.TrimSpace(unit))
	if u == "" {
		return n
	}
	switch u {
	case "mil", "k", "kz", "kzs":
		if n >= 10000 {
			return n
		}
		return n * 1000
	case "milhão", "milhões", "milhao", "milhoes", "m":
		return n * 1000000
	case "akz", "aoa", "usd", "$":
		return n
	}
	return n
}

// isPriceInRange returns 1 (ok), 0 (out of range), or -1 (not applicable).
func isPriceInRange(category string, price int) int {
	// Not applicable for non-listing categories.
	if category == "noise" || category == "seeker" {
		return -1
	}
	if price == 0 {
		return 0
	}
	switch category {
	case "rental":
		if price >= RentalMin && price <= RentalMax {
			return 1
		}
		return 0
	case "sale":
		if price >= SaleMin && price <= SaleMax {
			return 1
		}
		return 0
	}
	return -1
}

// adjustPrice tries ×1000 and ÷1000 to bring an out-of-range rental price
// into range. Returns (adjusted, ok).
func adjustPrice(price int, category string) (int, bool) {
	if category != "rental" || price <= 0 {
		return price, false
	}
	if price >= RentalMin && price <= RentalMax {
		return price, true
	}
	mul := price * 1000
	if mul >= RentalMin && mul <= RentalMax {
		return mul, true
	}
	if price >= 1000 && price%1000 == 0 {
		div := price / 1000
		if div >= RentalMin && div <= RentalMax {
			return div, true
		}
	}
	return price, false
}

func matchLocation(text string) string {
	lower := strings.ToLower(text)

	for _, base := range numberedBases {
		for _, digit := range []string{"0", "1", "2", "3", "4", "5"} {
			for _, pat := range []string{base + " " + digit, base + digit} {
				if strings.Contains(lower, pat) {
					for _, loc := range knownLocations {
						ll := strings.ToLower(loc)
						if strings.HasPrefix(ll, base+" ") && strings.HasSuffix(ll, " "+digit) {
							return loc
						}
					}
				}
			}
		}
	}

	for _, loc := range knownLocations {
		if strings.Contains(lower, strings.ToLower(loc)) {
			if hasTrailingNumber(loc) {
				continue
			}
			return loc
		}
	}

	words := reWord.FindAllString(text, -1)
	if len(words) == 0 {
		return ""
	}

	bestScore := 0.0
	bestLoc := ""
	for _, loc := range knownLocations {
		if hasTrailingNumber(loc) {
			continue
		}
		ll := strings.ToLower(loc)
		for windowSize := 1; windowSize <= 3; windowSize++ {
			for i := 0; i+windowSize <= len(words); i++ {
				candidate := strings.ToLower(strings.Join(words[i:i+windowSize], " "))
				score := similarity(candidate, ll)
				if score > bestScore {
					bestScore = score
					bestLoc = loc
				}
			}
		}
	}
	if bestScore >= 0.80 {
		return bestLoc
	}
	return ""
}

func extractLocationRaw(text string) string {
	lines := strings.Split(text, "\n")

	for _, line := range lines {
		lineLower := strings.ToLower(line)
		for _, marker := range locationMarkers {
			if idx := strings.Index(lineLower, marker); idx >= 0 {
				after := line[idx+len(marker):]
				after = strings.TrimLeft(after, " :,-\t")
				if len(after) > 2 {
					return truncateLocation(after)
				}
			}
		}
	}

	words := reWord.FindAllString(text, -1)
	for i, w := range words {
		wLower := strings.ToLower(w)
		if len(wLower) < 4 || len(wLower) > 15 {
			continue
		}
		for _, marker := range locationMarkers {
			if strings.ContainsAny(marker, " .:") {
				continue
			}
			score := similarity(wLower, marker)
			if score >= 0.78 {
				end := i + 6
				if end > len(words) {
					end = len(words)
				}
				candidate := strings.Join(words[i+1:end], " ")
				if len(candidate) > 2 {
					return truncateLocation(candidate)
				}
			}
		}
	}

	return ""
}

func truncateLocation(s string) string {
	s = strings.TrimSpace(s)
	s = strings.TrimRight(s, " .,;:-")
	if len(s) > 80 {
		s = s[:80] + "…"
	}
	return s
}

func hasTrailingNumber(loc string) bool {
	parts := strings.Fields(loc)
	if len(parts) < 2 {
		return false
	}
	last := parts[len(parts)-1]
	if len(last) != 1 {
		return false
	}
	return last[0] >= '0' && last[0] <= '9'
}

func similarity(a, b string) float64 {
	if a == b {
		return 1.0
	}
	if len(a) == 0 || len(b) == 0 {
		return 0.0
	}
	dist := levenshtein.ComputeDistance(a, b)
	maxLen := len(a)
	if len(b) > maxLen {
		maxLen = len(b)
	}
	return 1.0 - float64(dist)/float64(maxLen)
}

func ParseListing(msgID, chatName, chatJID, timestamp, sender, senderJID, text, displayText string) Listing {
	l := Listing{
		MsgID:     msgID,
		ChatName:  chatName,
		ChatJID:   chatJID,
		Sender:    sender,
		SenderJID: senderJID,
		Timestamp: timestamp,
		RawText:   text,
	}

	clean := strings.TrimSpace(text)

	if isNoise(clean, displayText) {
		l.Category = "noise"
		l.PriceOk = -1
		return l
	}

	for _, line := range strings.Split(clean, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || line == "👇🏽" || line == "👇" || strings.HasPrefix(line, ">") {
			continue
		}
		l.Title = line
		break
	}
	if len(l.Title) > 120 {
		l.Title = l.Title[:120] + "…"
	}

	if m := reTypology.FindString(clean); m != "" {
		l.Typology = strings.ToUpper(strings.ReplaceAll(m, " ", ""))
	}

	if m := rePriceK.FindStringSubmatch(clean); len(m) > 2 {
		l.Price = parseNumber(m[1])
		l.Price = applyMultiplier(l.Price, m[2])
		l.PriceText = strings.TrimSpace(m[0])
	} else if m := rePriceNum.FindStringSubmatch(clean); len(m) > 2 {
		l.Price = parseNumber(m[1])
		if len(m) > 2 {
			l.Price = applyMultiplier(l.Price, m[2])
		}
		l.PriceText = strings.TrimSpace(m[0])
	}

	l.Location = matchLocation(clean)
	l.LocationRaw = extractLocationRaw(clean)

	if m := rePhone.FindString(clean); m != "" {
		l.Phone = strings.ReplaceAll(strings.ReplaceAll(m, " ", ""), "-", "")
	} else if strings.HasSuffix(senderJID, "@s.whatsapp.net") {
		l.Phone = strings.TrimSuffix(senderJID, "@s.whatsapp.net")
	}

	l.Category = classify(clean)

	if l.Category == "rental" {
		if adj, ok := adjustPrice(l.Price, "rental"); ok {
			l.Price = adj
		}
	}

	l.PriceOk = isPriceInRange(l.Category, l.Price)

	return l
}

func classify(text string) string {
	lower := strings.ToLower(text)
	head := lower
	if len(head) > 120 {
		head = head[:120]
	}

	hasTypology := reTypology.MatchString(text)
	hasSeeker := reSeekerVerb.MatchString(head)
	hasRental := reRentalStrong.MatchString(lower) ||
		(reRentalWeak.MatchString(lower) && hasTypology)
	hasSale := reSaleStrong.MatchString(lower) ||
		(reSaleWeak.MatchString(lower) && hasTypology)
	hasCar := reCar.MatchString(lower)

	if hasSeeker {
		return "seeker"
	}
	if hasCar && !hasTypology {
		return "noise"
	}
	if hasSale {
		return "sale"
	}
	if hasRental {
		return "rental"
	}

	hasPrice := rePriceK.MatchString(text) || rePriceNum.MatchString(text)
	if hasTypology && hasPrice {
		return "rental"
	}

	return "noise"
}

func isNoise(text, displayText string) bool {
	if strings.HasPrefix(strings.TrimSpace(displayText), ">") {
		return true
	}
	if reMedia.MatchString(strings.TrimSpace(text)) {
		return true
	}
	if reSpam.MatchString(text) {
		return true
	}
	return false
}

func parseNumber(s string) int {
	s = strings.ReplaceAll(s, " ", "")
	s = strings.ReplaceAll(s, ".", "")
	s = strings.ReplaceAll(s, ",", "")
	n, _ := strconv.Atoi(s)
	return n
}