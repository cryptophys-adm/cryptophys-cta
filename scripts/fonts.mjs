// The fonts the home page uses: [@fontsource package, file], each served from /fonts/<file> (OFL, latin woff2 only).
// No dependency, so the tests read it before `npm ci`; scripts/build-room.mjs copies the files.
export const FONTS = [
  ["rajdhani", "rajdhani-latin-500-normal.woff2"], ["rajdhani", "rajdhani-latin-600-normal.woff2"], ["rajdhani", "rajdhani-latin-700-normal.woff2"],
  ["newsreader", "newsreader-latin-400-normal.woff2"], ["newsreader", "newsreader-latin-400-italic.woff2"], ["newsreader", "newsreader-latin-500-normal.woff2"]
];
