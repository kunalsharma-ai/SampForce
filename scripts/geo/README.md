# Country, region and city data

`build-geo-data.mjs` builds the location data behind the company and employee forms (ADR 0060):

- `packages/types/src/geo-countries.ts`: 248 countries with their English name, international dialling code,
  currency (ISO 4217) and IANA time zones. Names on screen come from the browser in the reader's language.
- `apps/api/assets/geo/regions.json.gz`: states, provinces and regions by country (ISO 3166-2 style codes).
- `apps/api/assets/geo/cities.json.gz`: places with 1,000 or more people, by country and region, largest first.

The API reads the two asset files on first use (`apps/api/src/geo`). People can always type a place that is not
listed.

## Sources and licences

| Data | Source | Licence |
| --- | --- | --- |
| Countries and time zones | [countries-and-timezones](https://github.com/manuelmhtr/countries-and-timezones) 3.11.0 | MIT |
| Dialling codes | [libphonenumber-js](https://gitlab.com/catamphetamine/libphonenumber-js) (already a web dependency) | MIT |
| Currencies | [country-to-currency](https://github.com/thiagodp/country-to-currency) 3.0.2 | MIT |
| States, provinces, regions | [dr5hn/countries-states-cities-database](https://github.com/dr5hn/countries-states-cities-database) `states.json` | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) |
| Cities | [all-the-cities](https://github.com/zeke/all-the-cities) 3.1.0, from [GeoNames](https://www.geonames.org/) | MIT (code), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (data) |
| Flags (web app) | [flag-icons](https://github.com/lipis/flag-icons) 7.6.0 | MIT |

What the licences ask of us:

- **GeoNames (CC BY 4.0)**: credit "City data © GeoNames (geonames.org), CC BY 4.0".
- **dr5hn states (ODbL 1.0)**: credit "Region data © countries-states-cities-database contributors, ODbL 1.0". The
  regions file is a derived database, so if it is shared publicly it must stay under ODbL. It ships as a separate
  file for that reason, and is not mixed into SampForce's own data.
- The MIT packages need their copyright notice kept with copies of the code; the generated files are data built from
  them, and this file records where they came from.

`country-state-city` was not used because it is GPL-3.0.

## Time zones (ADR 0089)

`build-zone-data.mjs` writes `packages/types/src/geo-zones.ts`: alpha-3 codes, UN subregions, the zone of each state and
of each city of 100,000+ people in countries with several zones. It reads dr5hn `countries.json` and `states.json`
(ODbL 1.0, same credit as above) and the cities file above:

```sh
curl -LO https://raw.githubusercontent.com/dr5hn/countries-states-cities-database/master/json/countries.json
node scripts/geo/build-zone-data.mjs countries.json states.json
```

Public holidays come from [date-holidays](https://github.com/commenthol/date-holidays) (ISC code, CC BY-SA 4.0 data),
an API dependency.

## Rebuilding

```sh
mkdir -p /tmp/geo && cd /tmp/geo
npm init -y && npm install countries-and-timezones@3.11.0 libphonenumber-js country-to-currency@3.0.2 all-the-cities@3.1.0
curl -LO https://raw.githubusercontent.com/dr5hn/countries-states-cities-database/master/json/states.json
cd -
node scripts/geo/build-geo-data.mjs /tmp/geo /tmp/geo/states.json
```

The script checks that every country has a dialling code, a currency and at least one time zone, and prints how
many regions and cities it wrote.
