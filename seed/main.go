package main

import (
	"database/sql"
	"flag"
	"fmt"
	"log"
	"math/rand"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

type wealthTier int

const (
	tierPrime wealthTier = iota
	tierMid
	tierLow
	tierPeripheral
)

var locationTier = map[string]wealthTier{
	// prime
	"Ingombota": tierPrime, "Maianga": tierPrime, "Miramar": tierPrime,
	"Alvalade": tierPrime, "Maculusso": tierPrime, "Cidade Alta": tierPrime,
	"Cidadela": tierPrime, "Marginal": tierPrime, "Ilha de Luanda": tierPrime,
	"Ilha do Cabo": tierPrime, "Talatona": tierPrime, "Nova Vida": tierPrime,
	"Morro Bento": tierPrime, "Golf 2": tierPrime, "Golf 1": tierPrime,
	"Golfe 1": tierPrime, "Golfe 2": tierPrime, "Golfo 2": tierPrime,
	"Patriota": tierPrime, "Lar do Patriota": tierPrime,
	"Futungo": tierPrime, "Futungo de Belas": tierPrime,
	"Belas Shopping": tierPrime, "Kilamba": tierPrime, "Kilamba Kiaxi": tierPrime,
	"Xyami": tierPrime, "Angomart": tierPrime, "Bairro Militar": tierPrime,

	// mid
	"Rangel": tierMid, "Samba": tierMid, "Cassenda": tierMid,
	"Prenda": tierMid, "Terra Nova": tierMid, "Cassequel": tierMid,
	"Bairro Popular": tierMid, "Estalagem": tierMid, "Vila Flor": tierMid,
	"Vila Alice": tierMid, "Vila Estoril": tierMid, "Tala Hady": tierMid,
	"Tala-Alice": tierMid, "Kimbango": tierMid, "Camama": tierMid,
	"Camama 1": tierMid, "Camama 2": tierMid, "Camama 3": tierMid,
	"Camama 4": tierMid, "Sapu": tierMid, "Mufulama": tierMid,
	"Sagrada Esperança": tierMid, "Vila Verde": tierMid, "Quenguela": tierMid,
	"Morro dos Veados": tierMid, "Kero": tierMid, "Aeroporto": tierMid,
	"Corimba": tierMid, "Jango": tierMid, "Rocha": tierMid,

	// low
	"Rocha Pinto": tierLow, "Fubu": tierLow, "Gamek": tierLow,
	"Soba Kapassa": tierLow, "Capolo": tierLow, "Petrangol": tierLow,
	"Palanca": tierLow, "Calemba": tierLow, "Dangereux": tierLow,
	"Bairro Azul": tierLow, "Bairro das Tendas": tierLow,
	"Bairro Operário": tierLow, "Quinanga": tierLow, "Margal": tierLow,
	"Catambor": tierLow, "Cuca": tierLow, "Mártires do Kifangondo": tierLow,
	"Mártires de Kifangondo": tierLow, "Morro da Luz": tierLow,
	"Ngola Kiluanje": tierLow, "Zamba": tierLow, "Kikolo": tierLow,
	"Cabolombo": tierLow, "Cazenga": tierLow, "Hoji ya Henda": tierLow,
	"Sambizanga": tierLow, "Chicala": tierLow, "Coqueiros": tierLow,
	"Mutamba": tierLow, "Fortaleza": tierLow, "Porto de Luanda": tierLow,
	"Mabor": tierLow, "São Paulo": tierLow,

	// peripheral
	"Zango": tierPeripheral, "Zango 0": tierPeripheral, "Zango 1": tierPeripheral,
	"Zango 2": tierPeripheral, "Zango 3": tierPeripheral, "Zango 4": tierPeripheral,
	"Zango 5": tierPeripheral, "Viana": tierPeripheral, "Luanda Sul": tierPeripheral,
	"Cacuaco": tierPeripheral, "Belas": tierPeripheral, "Panguila": tierPeripheral,
	"Sequele": tierPeripheral, "Kima Kieza": tierPeripheral,
	"Quinguele": tierPeripheral, "Kikuxi": tierPeripheral,
	"Ramiros": tierPeripheral, "Mussulo": tierPeripheral,
	"Icolo e Bengo": tierPeripheral, "Quissama": tierPeripheral,
}

func rentalPriceRange(t wealthTier) (int, int) {
	switch t {
	case tierPrime:
		return 700_000, 6_000_000
	case tierMid:
		return 250_000, 1_500_000
	case tierLow:
		return 80_000, 450_000
	default:
		return 35_000, 200_000
	}
}

func salePriceRange(t wealthTier) (int, int) {
	switch t {
	case tierPrime:
		return 90_000_000, 900_000_000
	case tierMid:
		return 35_000_000, 180_000_000
	case tierLow:
		return 12_000_000, 60_000_000
	default:
		return 5_000_000, 25_000_000
	}
}

func typologyPool(t wealthTier, cat string) []string {
	if cat == "seeker" {
		return []string{"T0", "T1", "T2", "T3", "T4", "V2", "V3", "QUARTO"}
	}
	switch t {
	case tierPrime:
		return []string{
			"T3", "T3", "T4", "T4", "T5",
			"V4", "V4", "V5",
			"DUPLEX", "APARTAMENTO", "MORADIA", "VIVENDA",
		}
	case tierMid:
		return []string{
			"T2", "T2", "T3", "T3", "T4",
			"V3", "V3", "V4",
			"APARTAMENTO", "APARTAMENTO", "MORADIA", "VIVENDA",
		}
	case tierLow:
		return []string{
			"T1", "T1", "T2", "T2", "T3",
			"V2", "V3",
			"APARTAMENTO", "QUARTO", "QUARTO",
		}
	default:
		return []string{
			"T0", "T0", "T1", "T1", "T2",
			"QUARTO", "QUARTO", "QUARTO", "APARTAMENTO",
		}
	}
}

var chats = []string{
	"Imóveis Luanda", "Arrendamento Kilamba", "Casas Talatona",
	"Luanda Rentals", "Grupo Imobiliário AO", "Viana Imóveis",
	"Zango Casas", "Apartamentos Luanda", "Rentals Talatona",
	"Imobiliária Belas", "Cacuaco Imóveis", "Angola Property Hub",
	"Casas & Terrenos Luanda", "Grupo Arrendamento AO", "Kilamba Kiaxi Imóveis",
}

var senderFirst = []string{
	"Ana", "João", "Maria", "Carlos", "Teresa", "Alberto", "Rosa",
	"Manuel", "Filipa", "Domingos", "Isabel", "Paulo", "Carla", "Rui",
	"Beatriz", "Nuno", "Sofia", "Miguel", "Helena", "André", "Lúcia",
}

var senderLast = []string{
	"Silva", "Pedro", "Fernandes", "Neto", "Lopes", "Cabral", "M.",
	"Santos", "Costa", "Sousa", "Pereira", "Rodrigues", "Almeida",
	"Gomes", "Martins", "Correia", "Dias", "Ramos", "Ferreira",
}

var agencyNames = []string{
	"Imobiliária Kwanza", "Prime Luanda", "Talatona Imóveis",
	"Belas Property", "AO Real Estate", "Kilamba Homes",
	"Luanda Prime Imóveis", "Grupo Kwanza Imobiliário",
}

var rentalOpeners = []string{
	"Arrenda-se", "Aluga-se", "Para arrendar", "Arrendamento",
	"Disponível para arrendamento", "Em arrendamento",
}

var saleOpeners = []string{
	"Vende-se", "À venda", "Para venda", "Venda de",
}

var seekerOpeners = []string{
	"Procuro", "Preciso de", "Estou à procura de",
	"Alguém tem", "Quem tem", "Procura-se",
}

var noiseTexts = []string{
	"Bom dia a todos",
	"Alguém sabe o preço do dólar hoje?",
	"Reunião marcada para amanhã às 10h",
	"Obrigado pela informação",
	"Boa tarde, alguém tem o contacto do Sr. António?",
	"Vendo terreno em Viana — contacto no DM",
	"Alguém recomenda um eletricista de confiança?",
	"Feliz aniversário! Muitos anos de vida.",
	"Grupo está muito silencioso hoje",
	"Quem vai à reunião de moradores amanhã?",
	"Off-topic: alguém sabe onde comprar cimento barato?",
	"Notícia: novas regras de trânsito em Luanda",
}

func pick[T any](r *rand.Rand, xs []T) T { return xs[r.Intn(len(xs))] }

func randomPhone(r *rand.Rand) string {
	return fmt.Sprintf("9%d%d %d%d%d %d%d%d",
		r.Intn(10), r.Intn(10),
		r.Intn(10), r.Intn(10), r.Intn(10),
		r.Intn(10), r.Intn(10), r.Intn(10))
}

func randomSender(r *rand.Rand) string {
	if r.Intn(100) < 25 {
		return pick(r, agencyNames)
	}
	return pick(r, senderFirst) + " " + pick(r, senderLast)
}

func priceInRange(r *rand.Rand, lo, hi int) int {
	u := r.Float64()
	u = u * u // bias low
	v := lo + int(u*float64(hi-lo))
	return (v / 5000) * 5000
}

// allLocations returns the flat list of locations from locationTier's keys.
func allLocations() []string {
	out := make([]string, 0, len(locationTier))
	for k := range locationTier {
		out = append(out, k)
	}
	return out
}

type row struct {
	msgID     string
	chatName  string
	chatJID   string
	timestamp string
	sender    string
	senderJID string
	title     string
	typology  string
	price     int
	priceText string
	location  string
	locRaw    string
	phone     string
	rawText   string
	category  string
}

// buildListing produces one seed row for the given index and category.
// `misclassify` forces the opener to belong to a different category, to give
// the parser deliberately wrong-but-plausible inputs.
func buildListing(r *rand.Rand, i int, cat string, locs []string, misclassify bool) row {
	loc := pick(r, locs)
	tier := locationTier[loc]

	typ := pick(r, typologyPool(tier, cat))

	var lo, hi int
	switch cat {
	case "rental", "seeker":
		lo, hi = rentalPriceRange(tier)
	case "sale":
		lo, hi = salePriceRange(tier)
	}
	var price int
	if cat != "noise" {
		price = priceInRange(r, lo, hi)
	}

	var opener string
	switch cat {
	case "rental":
		opener = pick(r, rentalOpeners)
	case "sale":
		opener = pick(r, saleOpeners)
	case "seeker":
		opener = pick(r, seekerOpeners)
	}

	if misclassify {
		switch cat {
		case "rental":
			opener = pick(r, seekerOpeners)
		case "seeker":
			opener = pick(r, rentalOpeners)
		case "sale":
			opener = pick(r, rentalOpeners)
		}
	}

	var title string
	if cat == "noise" {
		title = pick(r, noiseTexts)
	} else {
		title = fmt.Sprintf("%s %s em %s", opener, typ, loc)
		if typ == "" {
			title = fmt.Sprintf("%s imóvel em %s", opener, loc)
		}
		if r.Intn(100) < 15 {
			taglines := []string{
				"Ótima localização!",
				"Pronto a habitar.",
				"Zona tranquila.",
				"Com estacionamento.",
				"Mobilado.",
				"Bem servido de transportes.",
				"Vista desafogada.",
			}
			title = title + ". " + pick(r, taglines)
		}
	}

	priceText := ""
	if price > 0 {
		priceText = fmt.Sprintf("%d Kz", price)
	}

	phone := randomPhone(r)
	sender := randomSender(r)
	chat := pick(r, chats)

	msgID := fmt.Sprintf("seed-%s-%04d", cat, i)
	chatJID := "seed-" + strings.ReplaceAll(chat, " ", "-") + "@g.us"
	senderJID := fmt.Sprintf("%d@s.whatsapp.net", 244900000000+int64(r.Intn(99_999_999)))

	// Spread across the last 120 days, but make it feel clustered:
	// pick a random day, then a random hour.
	daysAgo := r.Intn(120)
	hour := 7 + r.Intn(15) // 7am–10pm
	minute := r.Intn(60)
	ts := time.Now().AddDate(0, 0, -daysAgo)
	ts = time.Date(ts.Year(), ts.Month(), ts.Day(), hour, minute, 0, 0, ts.Location())
	timestamp := ts.Format(time.RFC3339)

	var raw strings.Builder
	raw.WriteString(title)
	if cat != "noise" {
		raw.WriteString("\n📍 ")
		raw.WriteString(loc)
		if priceText != "" {
			raw.WriteString("\n💰 ")
			raw.WriteString(priceText)
		}
		if typ != "" {
			raw.WriteString("\n🏠 ")
			raw.WriteString(typ)
		}
		raw.WriteString("\n📞 ")
		raw.WriteString(phone)
	}

	return row{
		msgID:     msgID,
		chatName:  chat,
		chatJID:   chatJID,
		timestamp: timestamp,
		sender:    sender,
		senderJID: senderJID,
		title:     title,
		typology:  typ,
		price:     price,
		priceText: priceText,
		location:  loc,
		locRaw:    loc,
		phone:     phone,
		rawText:   raw.String(),
		category:  cat,
	}
}

func main() {
	dbPath := flag.String("db", "listings.dev.db", "database file to seed")
	seed := flag.Int64("seed", 42, "RNG seed for reproducibility")
	flag.Parse()

	r := rand.New(rand.NewSource(*seed))
	locs := allLocations()

	db, err := sql.Open("sqlite", *dbPath)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	if _, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS listings (
			msg_id TEXT PRIMARY KEY,
			chat_name TEXT, chat_jid TEXT,
			timestamp TEXT, sender TEXT, sender_jid TEXT,
			title TEXT, typology TEXT,
			price INTEGER, price_text TEXT,
			location TEXT, location_raw TEXT,
			phone TEXT, raw_text TEXT, category TEXT
		);
	`); err != nil {
		log.Fatal(err)
	}
	if _, err := db.Exec(`DELETE FROM listings`); err != nil {
		log.Fatal(err)
	}

	tx, err := db.Begin()
	if err != nil {
		log.Fatal(err)
	}
	stmt, err := tx.Prepare(`
		INSERT INTO listings
		(msg_id, chat_name, chat_jid, timestamp, sender, sender_jid,
		 title, typology, price, price_text, location, location_raw,
		 phone, raw_text, category)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		log.Fatal(err)
	}
	defer stmt.Close()

	// Exactly 100 of each category.
	// Within each category, ~8% are deliberately misclassified so the parser
	// audit has real errors to catch.
	categories := []string{"rental", "seeker", "sale", "noise"}
	const perCategory = 100

	insert := func(rw row) {
		if _, err := stmt.Exec(
			rw.msgID, rw.chatName, rw.chatJID, rw.timestamp, rw.sender, rw.senderJID,
			rw.title, rw.typology, rw.price, rw.priceText, rw.location, rw.locRaw,
			rw.phone, rw.rawText, rw.category,
		); err != nil {
			log.Fatalf("insert %s: %v", rw.msgID, err)
		}
	}

	for _, cat := range categories {
		for i := 0; i < perCategory; i++ {
			misclassify := false
			if cat != "noise" && r.Intn(100) < 8 {
				misclassify = true
			}
			insert(buildListing(r, i, cat, locs, misclassify))
		}
	}

	if err := tx.Commit(); err != nil {
		log.Fatal(err)
	}

	printSummary(db, *dbPath)
}

func printSummary(db *sql.DB, path string) {
	fmt.Println("seeded:")

	rows, err := db.Query(`SELECT category, COUNT(*) FROM listings GROUP BY category ORDER BY 1`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var c string
			var n int
			rows.Scan(&c, &n)
			fmt.Printf("  %-8s %d\n", c, n)
		}
	}

	var total int
	db.QueryRow(`SELECT COUNT(*) FROM listings`).Scan(&total)
	fmt.Printf("  %-8s %d\n", "TOTAL", total)

	fmt.Println("\nprice by category (min / max / avg, Kz):")
	rows2, err := db.Query(`
		SELECT category, MIN(price), MAX(price), AVG(price)
		FROM listings WHERE price > 0 GROUP BY category ORDER BY 1
	`)
	if err == nil {
		defer rows2.Close()
		for rows2.Next() {
			var c string
			var lo, hi int
			var avg float64
			rows2.Scan(&c, &lo, &hi, &avg)
			fmt.Printf("  %-8s %10d – %10d  avg %.0f\n", c, lo, hi, avg)
		}
	}

	fmt.Println("\ntop 10 locations:")
	rows3, err := db.Query(`SELECT location, COUNT(*) FROM listings WHERE location != '' GROUP BY location ORDER BY 2 DESC LIMIT 10`)
	if err == nil {
		defer rows3.Close()
		for rows3.Next() {
			var l string
			var n int
			rows3.Scan(&l, &n)
			fmt.Printf("  %-24s %d\n", l, n)
		}
	}

	var distinct int
	db.QueryRow(`SELECT COUNT(DISTINCT location) FROM listings WHERE location != ''`).Scan(&distinct)
	fmt.Printf("\ndistinct locations: %d\n", distinct)
	fmt.Printf("wrote %s\n", path)
}