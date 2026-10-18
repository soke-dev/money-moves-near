/**
 * Countries, for where an ID was issued and where a person lives: ISO codes,
 * named by the browser in English. Nigeria leads, the rest are alphabetical.
 */
const CODES =
  'AF AL DZ AD AO AG AR AM AU AT AZ BS BH BD BB BY BE BZ BJ BT BO BA BW BR BN BG BF BI CV KH CM CA CF TD CL CN CO KM CG CD CR CI HR CU CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FJ FI FR GA GM GE DE GH GR GD GT GN GW GY HT HN HK HU IS IN ID IR IQ IE IL IT JM JP JO KZ KE KI KW KG LA LV LB LS LR LY LI LT LU MO MG MW MY MV ML MT MH MR MU MX FM MD MC MN ME MA MZ MM NA NR NP NL NZ NI NE NG KP MK NO OM PK PW PS PA PG PY PE PH PL PT PR QA RO RU RW KN LC VC WS SM ST SA SN RS SC SL SG SK SI SB SO ZA KR SS ES LK SD SR SE CH SY TW TJ TZ TH TL TG TO TT TN TR TM TV UG UA AE GB US UY UZ VU VA VE VN YE ZM ZW'.split(' ')

const names = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' })
  } catch {
    return null
  }
})()

export const countryName = (code: string) => {
  try {
    return names?.of(code) ?? code
  } catch {
    return code
  }
}

export const COUNTRIES: { code: string; name: string }[] = [
  { code: 'NG', name: countryName('NG') },
  ...CODES.filter((c) => c !== 'NG')
    .map((code) => ({ code, name: countryName(code) }))
    .sort((a, b) => a.name.localeCompare(b.name)),
]

/** The IDs a person can hold, by where it was issued. */
export const idTypesFor = (country: string) =>
  country === 'NG' ? ['National ID (NIN)', 'International passport', "Driver's licence", "Voter's card"] : ['Passport', 'National ID card', "Driver's licence", 'Residence permit']
