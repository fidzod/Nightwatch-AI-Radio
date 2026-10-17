// Country options for the /settings page's selector.
//
// This is a code+name mirror of apps/engine/src/providers/countryData.ts's
// `COUNTRIES` keys — apps/web and apps/engine are separate pnpm workspaces
// with no shared package for this (only @airadio/db is shared), and this list
// is small enough that a second ~50-line copy is more pragmatic than a new
// shared package for it. Keep the codes in sync with countryData.ts: offering
// a code here that the engine doesn't recognize would silently fall back to
// GB over there, which would be a confusing mismatch for whoever picked it.
//
// Sorted by name, which is how it's rendered in the <select>.
export const COUNTRY_OPTIONS: { code: string; name: string }[] = [
	{ code: 'AR', name: 'Argentina' },
	{ code: 'AU', name: 'Australia' },
	{ code: 'AT', name: 'Austria' },
	{ code: 'BE', name: 'Belgium' },
	{ code: 'BR', name: 'Brazil' },
	{ code: 'CA', name: 'Canada' },
	{ code: 'CL', name: 'Chile' },
	{ code: 'CN', name: 'China' },
	{ code: 'CO', name: 'Colombia' },
	{ code: 'CZ', name: 'Czechia' },
	{ code: 'DK', name: 'Denmark' },
	{ code: 'EG', name: 'Egypt' },
	{ code: 'FI', name: 'Finland' },
	{ code: 'FR', name: 'France' },
	{ code: 'DE', name: 'Germany' },
	{ code: 'GH', name: 'Ghana' },
	{ code: 'GR', name: 'Greece' },
	{ code: 'IS', name: 'Iceland' },
	{ code: 'IN', name: 'India' },
	{ code: 'ID', name: 'Indonesia' },
	{ code: 'IE', name: 'Ireland' },
	{ code: 'IL', name: 'Israel' },
	{ code: 'IT', name: 'Italy' },
	{ code: 'JP', name: 'Japan' },
	{ code: 'KE', name: 'Kenya' },
	{ code: 'MY', name: 'Malaysia' },
	{ code: 'MX', name: 'Mexico' },
	{ code: 'MA', name: 'Morocco' },
	{ code: 'NL', name: 'Netherlands' },
	{ code: 'NZ', name: 'New Zealand' },
	{ code: 'NG', name: 'Nigeria' },
	{ code: 'NO', name: 'Norway' },
	{ code: 'PK', name: 'Pakistan' },
	{ code: 'PE', name: 'Peru' },
	{ code: 'PH', name: 'Philippines' },
	{ code: 'PL', name: 'Poland' },
	{ code: 'PT', name: 'Portugal' },
	{ code: 'RO', name: 'Romania' },
	{ code: 'SA', name: 'Saudi Arabia' },
	{ code: 'SG', name: 'Singapore' },
	{ code: 'ZA', name: 'South Africa' },
	{ code: 'KR', name: 'South Korea' },
	{ code: 'ES', name: 'Spain' },
	{ code: 'SE', name: 'Sweden' },
	{ code: 'CH', name: 'Switzerland' },
	{ code: 'TH', name: 'Thailand' },
	{ code: 'TR', name: 'Turkey' },
	{ code: 'UA', name: 'Ukraine' },
	{ code: 'AE', name: 'United Arab Emirates' },
	{ code: 'GB', name: 'United Kingdom' },
	{ code: 'US', name: 'United States' },
	{ code: 'VN', name: 'Vietnam' }
];

export const DEFAULT_COUNTRY = 'GB';
