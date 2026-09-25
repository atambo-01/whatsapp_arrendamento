package main

import (
	"regexp"
	"strconv"
	"strings"
)

type Listing struct {
	MsgID     string
	ChatName  string
	Timestamp string
	Sender    string
	Title     string
	Typology  string
	Price     int
	PriceText string
	Location  string
	Phone     string
	RawText   string
	Category  string // "rental" | "seeker" | "sale" | "noise"
}

// ---------- regexes ----------

var (
	// rental verb forms — arrenda-se, arrendar: at start, em arrendamento, aluga-se, para aluguer
	reRentalVerb = regexp.MustCompile(`(?i)(arrenda[\s\-]?se|arrendam[\s\-]?se|aluga[\s\-]?se|\barrendar\s*:|\bem arrendamento\b|\bpara aluguer\b|\bpara arrendar\b|\barrendamento\b)`)

	// seeker verbs — must be near the start to avoid false positives
	reSeekerVerb = regexp.MustCompile(`(?i)(\bprocuro\b|\bprocura[\s\-]?se\b|\bpreciso (de|duma|dum)\b|\bestou a procura\b|\bquero uma\b|\bquero um\b|\balgu[eé]m tem\b|\bquem tem\b)`)

	// sale verbs
	reSaleVerb = regexp.MustCompile(`(?i)(\bvende[\s\-]?se\b|\bvendo\b|\bà venda\b|\bpara venda\b|\bvenda de\b)`)

	// typology — T0..T5, V2..V5, and spelled-out forms
	reTypology = regexp.MustCompile(`(?i)\b(T[\s\-]?[0-5]|V[\s\-]?[2-5]|duplex|apartamento|vivenda|moradia|quarto|residencial)\b`)

	// price
	rePriceK   = regexp.MustCompile(`(?i)(\d{1,3}(?:[.,\s]\d{3})+|\d+)\s*(mil|kz|kzs|akz|aoa|kwanzas?)`)
	rePriceNum = regexp.MustCompile(`(?i)(?:plafond|pre[çc]o|valor|renda|plafon)\s*[:\-]?\s*(\d{1,3}(?:[.,\s]\d{3})*|\d+)\s*(mil)?`)

	// phone: 9XX XXX XXX or 9XXXXXXXX
	rePhone = regexp.MustCompile(`\b(?:9\d{2}[\s\-]?\d{3}[\s\-]?\d{3}|9\d{8})\b`)

	// admin / intermediary / meta signals
	reMeta = regexp.MustCompile(`(?i)(taxa de servi[çc]o|taxa de visita|comiss[ãa]o|desloca[çc][ãa]o|sou (a )?propriet[áa]ri[ao])`)

	// spam / noise
	reSpam = regexp.MustCompile(`(?i)(kwanzabet|shopee\.com\.br|chat vip|affiliates/?btag|wa\.me/message)`)

	// media-only placeholder
	reMedia = regexp.MustCompile(`^(sent (image|video|audio|sticker|document)|\(message\))$`)
)

// Locations we look for. Not exhaustive — add more as they show up in data.
var knownLocations = []string{
	"Talatona", "Camama", "Morro Bento", "Golf 2", "Golfo 2", "Nova Vida",
	"Zango", "Viana", "Luanda Sul", "Kilamba", "Patriota", "Samba",
	"Benfica", "Rocha Pinto", "Cazenga", "Rangel", "Maianga", "Fubu",
	"Gamek", "Soba Kapassa", "Capolo", "Petrangol", "Cacuaco", "Palanca",
	"Calemba", "Mufulama", "Cassenda", "Prenda", "Futungo", "Corimba",
	"Ilha de Luanda", "Cazenga", "Tala Hady", "Kimbango", "Kikuxi",
}

// ---------- main parser ----------

func ParseListing(msgID, chatName, timestamp, sender, text, displayText string) Listing {
	l := Listing{
		MsgID:     msgID,
		ChatName:  chatName,
		Timestamp: timestamp,
		Sender:    sender,
		RawText:   text,
	}

	clean := strings.TrimSpace(text)

	// --- noise fast paths ---
	if isNoise(clean, displayText) {
		l.Category = "noise"
		return l
	}

	// --- title: first non-empty line, skipping arrows and markers ---
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

	// --- typology ---
	if m := reTypology.FindString(clean); m != "" {
		l.Typology = strings.ToUpper(strings.ReplaceAll(m, " ", ""))
	}

	// --- price ---
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

	// --- location ---
	lower := strings.ToLower(clean)
	for _, loc := range knownLocations {
		if strings.Contains(lower, strings.ToLower(loc)) {
			l.Location = loc
			break
		}
	}

	// --- phone ---
	if m := rePhone.FindString(clean); m != "" {
		l.Phone = strings.ReplaceAll(strings.ReplaceAll(m, " ", ""), "-", "")
	}

	// --- category ---
	l.Category = classify(clean)

	return l
}

// classify decides rental / seeker / sale / noise based on signals.
func classify(text string) string {
	lower := strings.ToLower(text)

	// Seekers: verb in the first ~80 chars
	head := lower
	if len(head) > 80 {
		head = head[:80]
	}
	hasSeeker := reSeekerVerb.MatchString(head)

	hasRental := reRentalVerb.MatchString(lower)
	hasSale := reSaleVerb.MatchString(lower)

	// both? rental wins if it appears with taxa/comissão and no seeker
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

// isNoise returns true for messages that are obviously not listings.
func isNoise(text, displayText string) bool {
	// reply fragments — the displayText starts with > when it's a quoted reply
	if strings.HasPrefix(strings.TrimSpace(displayText), ">") {
		return true
	}
	if reMedia.MatchString(strings.TrimSpace(text)) {
		return true
	}
	if reSpam.MatchString(text) {
		return true
	}
	// very short messages are chatter
	if len(strings.TrimSpace(text)) < 30 {
		return true
	}
	return false
}

// parseNumber strips separators and converts to int.
func parseNumber(s string) int {
	s = strings.ReplaceAll(s, " ", "")
	s = strings.ReplaceAll(s, ".", "")
	s = strings.ReplaceAll(s, ",", "")
	n, _ := strconv.Atoi(s)
	return n
}