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
	IsRental  bool
}

var (
	reTypology = regexp.MustCompile(`(?i)\b(T[0-5]|V[0-5]|duplex|apartamento|vivenda|moradia|quarto)\b`)
	rePriceK   = regexp.MustCompile(`(?i)(\d{1,3}(?:[.,\s]\d{3})*|\d+)\s*(mil|kz|kzs|kzs|kwanzas?)`)
	rePriceNum = regexp.MustCompile(`(?i)(?:plafond|pre[çc]o|valor|renda|pago|paga)\s*[:\-]?\s*(\d{1,3}(?:[.,\s]\d{3})*|\d+)\s*(mil)?`)
	rePhone    = regexp.MustCompile(`\b(?:9\d{2}[\s\-]?\d{3}[\s\-]?\d{3}|9\d{8})\b`)
	reRental   = regexp.MustCompile(`(?i)(arrend|alug|renda|plafond|inquilino|senhorio|t[0-5]\b)`)
)

var knownLocations = []string{
	"Talatona", "Camama", "Morro Bento", "Golf 2", "Golfo 2", "Nova Vida",
	"Zango", "Viana", "Luanda Sul", "Kilamba", "Patriota", "Samba",
	"Benfica", "Rocha Pinto", "Cazenga", "Rangel", "Maianga", "Fubu",
	"Gamek", "Soba Kapassa", "Capolo", "Petrangol", "Cacuaco",
}

func ParseListing(msgID, chatName, timestamp, sender, text string) Listing {
	l := Listing{
		MsgID:     msgID,
		ChatName:  chatName,
		Timestamp: timestamp,
		Sender:    sender,
		RawText:   text,
	}

	clean := strings.TrimSpace(text)
	if clean == "" || strings.HasPrefix(clean, "Sent ") || clean == "(message)" {
		return l
	}

	// Title: first non-empty line, trimmed
	for _, line := range strings.Split(clean, "\n") {
		line = strings.TrimSpace(line)
		if line != "" && !strings.HasPrefix(line, ">") {
			l.Title = line
			break
		}
	}
	if len(l.Title) > 120 {
		l.Title = l.Title[:120] + "…"
	}

	l.IsRental = reRental.MatchString(clean)

	if m := reTypology.FindString(clean); m != "" {
		l.Typology = strings.ToUpper(m)
	}

	// Price: try explicit kz/mil first, then keyword-prefixed
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

	// Location: first known location match
	lower := strings.ToLower(clean)
	for _, loc := range knownLocations {
		if strings.Contains(lower, strings.ToLower(loc)) {
			l.Location = loc
			break
		}
	}

	if m := rePhone.FindString(clean); m != "" {
		l.Phone = strings.ReplaceAll(strings.ReplaceAll(m, " ", ""), "-", "")
	}

	return l
}

func parseNumber(s string) int {
	s = strings.ReplaceAll(s, " ", "")
	s = strings.ReplaceAll(s, ".", "")
	s = strings.ReplaceAll(s, ",", "")
	n, _ := strconv.Atoi(s)
	return n
}
