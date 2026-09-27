package main

import "math"

// Proximity helpers: coordinate resolution and distance calculation.
// parentLocation rolls numbered variants (Zango 1..5, Golf 1..2, ...) onto a
// base neighborhood that exists in coords.go, so /api/nearby doesn't silently
// drop listings whose exact location string isn't geocoded.

var parentLocation = map[string]string{
	"Zango 0": "Zango", "Zango 1": "Zango", "Zango 2": "Zango",
	"Zango 3": "Zango", "Zango 4": "Zango", "Zango 5": "Zango",
	"Golf 1":  "Golf 2", "Golfe 1": "Golf 2", "Golfo 2": "Golf 2", "Golfe 2": "Golf 2",
	"Camama 1": "Camama", "Camama 2": "Camama",
	"Camama 3": "Camama", "Camama 4": "Camama",
	"Calemba 2":       "Calemba",
	"Kilamba Kiaxi":   "Kilamba",
	"Ilha do Cabo":    "Ilha de Luanda",
	"Futungo de Belas": "Futungo",
	"Lar do Patriota": "Patriota",
	"Mártires do Kifangondo": "Samba",
	"Mártires de Kifangondo": "Samba",
	"Vila Alice":      "Vila Flor",
	"Vila Estoril":    "Cassequel",
	"Bairro Operário": "Maianga",
	"Bairro Azul":     "Maianga",
	"Bairro das Tendas": "Rangel",
	"Tala-Alice":      "Tala Hady",
}

func haversineKm(lat1, lon1, lat2, lon2 float64) float64 {
	const R = 6371.0
	dLat := (lat2 - lat1) * math.Pi / 180
	dLon := (lon2 - lon1) * math.Pi / 180
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*math.Pi/180)*math.Cos(lat2*math.Pi/180)*
			math.Sin(dLon/2)*math.Sin(dLon/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return R * c
}

func resolveCoords(location, locationRaw string) (lat, lng float64, ok bool) {
	key := location
	if p, exists := parentLocation[key]; exists {
		key = p
	}
	if c, exists := locationCoords[key]; exists {
		return c[0], c[1], true
	}
	if locationRaw != "" {
		if loc := matchLocation(locationRaw); loc != "" {
			if p, exists := parentLocation[loc]; exists {
				loc = p
			}
			if c, exists := locationCoords[loc]; exists {
				return c[0], c[1], true
			}
		}
	}
	return 0, 0, false
}