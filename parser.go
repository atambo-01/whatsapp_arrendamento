package main

import (
	"regexp"
	"strconv"
	"strings"
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
)

var knownLocations = []string{
	"Talatona", "Camama", "Morro Bento", "Golf 2", "Golfo 2", "Nova Vida",
	"Zango", "Viana", "Luanda Sul", "Kilamba", "Patriota", "Samba",
	"Benfica", "Rocha Pinto", "Cazenga", "Rangel", "Maianga", "Fubu",
	"Gamek", "Soba Kapassa", "Capolo", "Petrangol", "Cacuaco", "Palanca",
	"Calemba", "Mufulama", "Cassenda", "Prenda", "Futungo", "Corimba",
	"Ilha de Luanda", "Tala Hady", "Kimbango", "Kikuxi",
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

	lower := strings.ToLower(clean)
	for _, loc := range knownLocations {
		if strings.Contains(lower, strings.ToLower(loc)) {
			l.Location = loc
			break
		}
	}

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