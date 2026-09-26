package main

import (
	"regexp"
	"strconv"
	"strings"

	"github.com/agnivade/levenshtein"
)

type Listing struct {
	MsgID     string
	ChatName  string
	ChatJID   string
	Sender    string
	SenderJID string
	Timestamp string
	Title     string
	Typology  string
	Price     int
	PriceText string
	Location  string
	Phone     string
	RawText   string
	Category  string
}

var (
	reRentalVerb = regexp.MustCompile(`(?i)(arrenda[\s\-]?se|arrendam[\s\-]?se|aluga[\s\-]?se|\barrendar\s*:|\bem arrendamento\b|\bpara aluguer\b|\bpara arrendar\b|\barrendamento\b)`)
	reSeekerVerb = regexp.MustCompile(`(?i)(\bprocuro\b|\bprocura[\s\-]?se\b|\bpreciso (de|duma|dum)\b|\bestou a procura\b|\bquero uma\b|\bquero um\b|\balgu[eé]m tem\b|\bquem tem\b)`)
	reSaleVerb   = regexp.MustCompile(`(?i)(\bvende[\s\-]?se\b|\bvendo\b|\bà venda\b|\bpara venda\b|\bvenda de\b)`)
	reTypology   = regexp.MustCompile(`(?i)\b(T[\s\-]?[0-5]|V[\s\-]?[2-5]|duplex|apartamento|vivenda|moradia|quarto|residencial)\b`)
	rePriceK     = regexp.MustCompile(`(?i)(\d{1,3}(?:[.,\s]\d{3})+|\d+)\s*(mil|kz|kzs|akz|aoa|kwanzas?)`)
	rePriceNum   = regexp.MustCompile(`(?i)(?:plafond|pre[çc]o|valor|renda|plafon)\s*[:\-]?\s*(\d{1,3}(?:[.,\s]\d{3})*|\d+)\s*(mil)?`)
	rePhone      = regexp.MustCompile(`\b(?:9\d{2}[\s\-]?\d{3}[\s\-]?\d{3}|9\d{8})\b`)
	reSpam       = regexp.MustCompile(`(?i)(kwanzabet|shopee\.com\.br|chat vip|affiliates/?btag|wa\.me/message)`)
	reMedia      = regexp.MustCompile(`^(sent (image|video|audio|sticker|document)|\(message\))$`)
	reWord       = regexp.MustCompile(`[A-Za-zÀ-ÿ0-9]+`)
)

var knownLocations = []string{
	// Municipalities & major districts
	"Talatona", "Belas", "Cacuaco", "Cazenga", "Viana", "Kilamba Kiaxi",
	"Kilamba", "Icolo e Bengo", "Quissama", "Mussulo", "Ingombota",
	"Maianga", "Rangel", "Samba", "Sambizanga", "Hoji ya Henda",

	// Core neighborhoods
	"Camama", "Morro Bento", "Nova Vida", "Golf 2", "Golfo 2", "Golfe 2",
	"Golf 1", "Golfe 1", "Zango", "Luanda Sul", "Patriota", "Lar do Patriota",
	"Benfica", "Rocha Pinto", "Rocha", "Fubu", "Gamek", "Soba Kapassa",
	"Capolo", "Petrangol", "Palanca", "Calemba", "Mufulama", "Cassenda",
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

	// Landmarks / reference places
	"Angomart", "Kero", "Xyami", "Belas Shopping", "Fortaleza",
	"Cidadela", "Aeroporto", "Porto de Luanda", "Marginal", "Miramar",
	"Alvalade", "Maculusso", "Mutamba", "Coqueiros", "Chicala",
	"Bairro Operário", "Quinanga", "Margal", "Estalagem",
}

// Base names that expect a numeric suffix. We handle these before fuzzy matching
// so "Golf 1" can't accidentally match "Golf 2".
var numberedBases = []string{"golf", "golfe", "golfo", "zango", "camama"}

// matchLocation tries to find the best location match in the text.
func matchLocation(text string) string {
	lower := strings.ToLower(text)

	// Pass 0: numbered base + digit → exact build, before anything else.
	// e.g. text contains "golf 1" → return "Golf 1".
	for _, base := range numberedBases {
		// look for "<base> <digit>" or "<base><digit>"
		for _, digit := range []string{"0", "1", "2", "3", "4", "5"} {
			patterns := []string{
				base + " " + digit,
				base + digit,
			}
			for _, pat := range patterns {
				if strings.Contains(lower, pat) {
					// find the canonical form in the list
					for _, loc := range knownLocations {
						locLower := strings.ToLower(loc)
						if strings.HasPrefix(locLower, base+" ") && strings.HasSuffix(locLower, " "+digit) {
							return loc
						}
					}
				}
			}
		}
	}

	// Pass 1: exact substring match against known locations.
	for _, loc := range knownLocations {
		if strings.Contains(lower, strings.ToLower(loc)) {
			// If the matched location has a trailing number, make sure the text
			// isn't actually pointing at a different number. If so, skip.
			if hasTrailingNumber(loc) {
				// Only accept if the exact "base number" appears (already handled above),
				// so this branch effectively means: reject and let fuzzy decide.
				continue
			}
			return loc
		}
	}

	// Pass 2: fuzzy on word windows of 1-3 words.
	words := reWord.FindAllString(text, -1)
	if len(words) == 0 {
		return ""
	}

	bestScore := 0.0
	bestLoc := ""

	for _, loc := range knownLocations {
		// Skip numbered locations in fuzzy — they were handled in pass 0.
		if hasTrailingNumber(loc) {
			continue
		}
		locLower := strings.ToLower(loc)
		for windowSize := 1; windowSize <= 3; windowSize++ {
			for i := 0; i+windowSize <= len(words); i++ {
				candidate := strings.ToLower(strings.Join(words[i:i+windowSize], " "))
				score := similarity(candidate, locLower)
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

// hasTrailingNumber reports whether a location name ends with " <digit>".
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

// similarity returns 1.0 for identical strings, 0.0 for completely different.
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

	if m := rePhone.FindString(clean); m != "" {
		l.Phone = strings.ReplaceAll(strings.ReplaceAll(m, " ", ""), "-", "")
	} else if strings.HasSuffix(senderJID, "@s.whatsapp.net") {
		l.Phone = strings.TrimSuffix(senderJID, "@s.whatsapp.net")
	}

	l.Category = classify(clean)

	return l
}

func classify(text string) string {
	lower := strings.ToLower(text)
	head := lower
	if len(head) > 80 {
		head = head[:80]
	}
	hasSeeker := reSeekerVerb.MatchString(head)
	hasRental := reRentalVerb.MatchString(lower)
	hasSale := reSaleVerb.MatchString(lower)

	if hasRental && !hasSeeker {
		return "rental"
	}
	if hasSeeker {
		return "seeker"
	}
	if hasSale {
		return "sale"
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
	if len(strings.TrimSpace(text)) < 30 {
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