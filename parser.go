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
	Location    string
	LocationRaw string
	Phone       string
	RawText     string
	Category    string
}

var (
	reRentalVerb = regexp.MustCompile(`(?i)(` +
		`arrenda[\s\-]?se|arrendam[\s\-]?se|` +
		`aluga[\s\-]?se|` +
		`\barrendo\b|\balugo\b|\balugando\b|\barrendando\b|` +
		`\bestou a alugar\b|\bestou alugando\b|` +
		`\bestou a arrendar\b|\bestou arrendando\b|` +
		`\barrendar\s*:|\bpara aluguer\b|\bpara arrendar\b|` +
		`\bem arrendamento\b|\barrendamento\b|\baluguer\b` +
		`)`)

	// Seeker verbs: note the accent-tolerant "à/a" and the alternation on
	// "estou (à|a|em) procura" — the previous version only matched the
	// unaccented "a procura", which the seeder produces as "à procura".
	reSeekerVerb = regexp.MustCompile(`(?i)(` +
		`\bprocuro\b|\bprocuramos\b|\bprocura[\s\-]?se\b|` +
		`\bpreciso (de|duma|dum)\b|` +
		`\bestou (à|a|em)? ?procura\b|\bando à procura\b|` +
		`\bquero uma\b|\bquero um\b|` +
		`\balgu[eé]m tem\b|\bquem tem\b|\balgu[eé]m sabe\b` +
		`)`)

	// Sale verbs. IMPORTANT: no \b before accented chars (à, está) — Go's
	// regexp \b is ASCII-only and fails to match when the next rune is
	// non-ASCII. That bug put "VIVENDA V3 À VENDA" into rentals.
	reSaleVerb = regexp.MustCompile(`(?i)(` +
		`\bvende[\s\-]?se\b|\bvendo\b|\bvendemos\b|` +
		`à venda|para venda|\bvenda de\b|está à venda` +
		`)`)

	reTypology = regexp.MustCompile(`(?i)\b(` +
		`T[\s\-]?[0-9]|V[\s\-]?[0-9]|` +
		`duplex|apartamento|vivenda|moradia|quarto|residencial` +
		`)\b`)

	rePriceK = regexp.MustCompile(`(?i)(\d{1,3}(?:[.,\s]\d{3})+|\d+)\s*(mil|kz|kzs|akz|aoa|kwanzas?)`)

	rePriceNum = regexp.MustCompile(`(?i)(?:plafond|pre[çc]o|valor|renda|plafon|mensalidade|por m[êe]s|mensal)\s*[:\-]?\s*(\d{1,3}(?:[.,\s]\d{3})*|\d+)\s*(mil)?`)

	rePhone = regexp.MustCompile(`\b(?:9\d{2}[\s\-]?\d{3}[\s\-]?\d{3}|9\d{8})\b`)

	reSpam = regexp.MustCompile(`(?i)(kwanzabet|shopee\.com\.br|chat vip|affiliates/?btag|wa\.me/message|bet\s?\d|cassino|aposta)`)

	reMedia = regexp.MustCompile(`^(sent (image|video|audio|sticker|document)|\(message\))$`)

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
	// Municipalities & major districts
	"Talatona", "Belas", "Cacuaco", "Cazenga", "Viana", "Kilamba Kiaxi",
	"Kilamba", "Icolo e Bengo", "Quissama", "Mussulo", "Ingombota",
	"Maianga", "Rangel", "Samba", "Sambizanga", "Hoji ya Henda",

	// Core neighborhoods
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

	// Zones with numbers
	"Zango 0", "Zango 1", "Zango 2", "Zango 3", "Zango 4", "Zango 5",
	"Camama 1", "Camama 2", "Camama 3", "Camama 4",
	"Calemba 2",

	// Landmarks / reference places
	"Angomart", "Kero", "Xyami", "Belas Shopping", "Fortaleza",
	"Cidadela", "Aeroporto", "Porto de Luanda", "Marginal", "Miramar",
	"Alvalade", "Maculusso", "Mutamba", "Coqueiros", "Chicala",
	"Bairro Operário", "Quinanga", "Margal", "Estalagem",
}

var numberedBases = []string{"golf", "golfe", "golfo", "zango", "camama", "calemba"}

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
		if strings.EqualFold(m[2], "mil") {
			l.Price *= 1000
		}
		l.PriceText = m[0]
	} else if m := rePriceNum.FindStringSubmatch(clean); len(m) > 2 {
		l.Price = parseNumber(m[1])
		if m[2] != "" {
			l.Price *= 1000
		}
		l.PriceText = m[0]
	}

	l.Location = matchLocation(clean)
	l.LocationRaw = extractLocationRaw(clean)

	if m := rePhone.FindString(clean); m != "" {
		l.Phone = strings.ReplaceAll(strings.ReplaceAll(m, " ", ""), "-", "")
	} else if strings.HasSuffix(senderJID, "@s.whatsapp.net") {
		l.Phone = strings.TrimSuffix(senderJID, "@s.whatsapp.net")
	}

	l.Category = classify(clean)

	return l
}

// classify decides a listing's category. Rules are tried in strict priority
// order — the first match wins. Verbs in the title carry the strongest signal;
// structural fallbacks (typology + price) only apply when no verb matches.
func classify(text string) string {
	lower := strings.ToLower(text)
	head := lower
	if len(head) > 120 {
		head = head[:120]
	}

	hasSeeker := reSeekerVerb.MatchString(head)
	hasRental := reRentalVerb.MatchString(lower)
	hasSale := reSaleVerb.MatchString(lower)

	// Priority 1: explicit seeker verb. This wins over everything else,
	// including a rental or sale verb later in the same post, because the
	// seeker verb sets the author's intent ("I'm looking for X"). This also
	// handles the case where a seeker post quotes what they want
	// ("procuro arrendamento...") without being misread as a rental ad.
	if hasSeeker {
		return "seeker"
	}

	// Priority 2: explicit sale verb. Sales are rarer than rentals, so if
	// both appear, prefer sale (the seller usually leads with "vende-se").
	if hasSale {
		return "sale"
	}

	// Priority 3: explicit rental verb.
	if hasRental {
		return "rental"
	}

	// Priority 4: structural fallback. Typology + price is a strong signal
	// for a rental ad with no verb, but only if we didn't hit any of the
	// above. This is last because it's the least reliable.
	hasTypology := reTypology.MatchString(text)
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