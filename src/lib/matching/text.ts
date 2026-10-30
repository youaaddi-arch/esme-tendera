/**
 * Normalisation lexicale française.
 *
 * Le moteur de matching compare des textes d'acheteurs publics (avis, CCTP) à
 * des fiches de formation. Ces deux vocabulaires ne se recouvrent pas
 * littéralement : « montée en compétences des agents » et « formation » ne
 * partagent aucun mot. La normalisation réduit donc chaque texte à un sac de
 * lexèmes stables (sans accents, sans flexions de surface, sans mots vides),
 * sur lequel l'expansion par synonymes du module voisin peut ensuite agir.
 */

/** Retire les accents et met en minuscules. */
export function deaccent(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

const STOPWORDS = new Set([
  "a", "afin", "ainsi", "alors", "au", "aucun", "aucune", "aujourd", "auprès", "aupres",
  "aussi", "autre", "autres", "aux", "avec", "avoir", "b", "c", "car", "ce", "cela",
  "celle", "celles", "celui", "ces", "cet", "cette", "ceux", "chaque", "chez", "comme",
  "d", "dans", "de", "des", "deux", "doit", "doivent", "donc", "dont", "du", "elle",
  "elles", "en", "encore", "entre", "est", "et", "etre", "eux", "faire", "fait", "hui",
  "il", "ils", "j", "je", "l", "la", "le", "les", "leur", "leurs", "lors", "lui", "m",
  "mais", "me", "meme", "mes", "mon", "n", "ne", "ni", "non", "nos", "notre", "nous",
  "on", "ont", "ou", "par", "parmi", "pas", "peut", "peuvent", "plus", "pour", "pres",
  "qu", "que", "quel", "quelle", "quelles", "quels", "qui", "quoi", "s", "sa", "sans",
  "se", "selon", "ses", "si", "sont", "sous", "soit", "sur", "t", "ta", "te", "tes",
  "toi", "ton", "tous", "tout", "toute", "toutes", "tres", "tu", "un", "une", "vos",
  "votre", "vous", "y", "etc", "cf", "ex", "lot", "n°", "no",
]);

/**
 * Troncature morphologique légère.
 *
 * Un vrai stemmer français (Snowball) couperait trop court sur le vocabulaire
 * technique (« réseaux » → « resal ») et créerait des collisions entre termes
 * métier. On se limite donc aux flexions régulières qui font réellement rater
 * des correspondances : pluriels, féminins, et les suffixes verbaux courants.
 */
export function stem(token: string): string {
  let t = token;
  if (t.length <= 4) return t;
  for (const suffix of ["ations", "ation", "ements", "ement", "ences", "ence", "ances", "ance", "ismes", "isme", "euses", "euse", "eurs", "eur", "ives", "ive", "ifs", "if", "iques", "ique"]) {
    if (t.length > suffix.length + 3 && t.endsWith(suffix)) {
      t = t.slice(0, -suffix.length);
      break;
    }
  }
  // « réseaux » → « réseau », mais « journaux » → « journal ». L'ordre compte :
  // appliquer la règle en -al à « réseaux » donnerait « reseal », qui ne
  // rejoindrait jamais le singulier.
  if (t.length > 5 && t.endsWith("eaux")) t = t.slice(0, -1);
  else if (t.length > 4 && t.endsWith("aux")) t = `${t.slice(0, -3)}al`;
  // « heureux », « nombreux » : invariables en nombre, rien à retirer.
  if (t.length > 4 && t.endsWith("es")) t = t.slice(0, -2);
  else if (t.length > 4 && t.endsWith("s")) t = t.slice(0, -1);
  if (t.length > 4 && t.endsWith("e")) t = t.slice(0, -1);
  return t;
}

/** Découpe un texte en lexèmes normalisés, sans mots vides. */
export function tokenize(input: string): string[] {
  if (!input) return [];
  return deaccent(input)
    .replace(/['’]/g, " ")
    .split(/[^a-z0-9+]+/)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word) && !/^\d{1,2}$/.test(word))
    .map(stem);
}

/** Lexèmes simples plus bigrammes : « intelligence artificielle » compte comme un concept. */
export function tokenizeWithBigrams(input: string): string[] {
  const unigrams = tokenize(input);
  const bigrams: string[] = [];
  for (let i = 0; i < unigrams.length - 1; i += 1) {
    bigrams.push(`${unigrams[i]}_${unigrams[i + 1]}`);
  }
  return [...unigrams, ...bigrams];
}

export type TermVector = Map<string, number>;

/** Compte les occurrences, borné pour qu'un mot répété ne domine pas le vecteur. */
export function termVector(tokens: string[]): TermVector {
  const vector: TermVector = new Map();
  for (const token of tokens) {
    vector.set(token, Math.min((vector.get(token) ?? 0) + 1, 4));
  }
  return vector;
}

/**
 * Similarité cosinus pondérée par l'IDF.
 *
 * L'IDF est indispensable ici : « formation » apparaît dans presque toutes les
 * fiches et dans presque tous les avis, il ne discrimine rien. Ce sont
 * « photovoltaïque » ou « HTA » qui portent l'information.
 */
export function cosine(a: TermVector, b: TermVector, idf: Map<string, number>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [term, count] of a) {
    const weight = count * (idf.get(term) ?? 1);
    normA += weight * weight;
    const other = b.get(term);
    if (other !== undefined) dot += weight * other * (idf.get(term) ?? 1);
  }
  for (const [term, count] of b) {
    const weight = count * (idf.get(term) ?? 1);
    normB += weight * weight;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** IDF lissé, calculé sur le corpus des fiches de formation. */
export function buildIdf(documents: string[][]): Map<string, number> {
  const frequency = new Map<string, number>();
  for (const tokens of documents) {
    for (const term of new Set(tokens)) {
      frequency.set(term, (frequency.get(term) ?? 0) + 1);
    }
  }
  const total = Math.max(documents.length, 1);
  const idf = new Map<string, number>();
  for (const [term, count] of frequency) {
    idf.set(term, Math.log((total + 1) / (count + 0.5)) + 1);
  }
  return idf;
}

/** Part des termes de `needles` présents dans `haystack`. */
export function coverage(needles: string[], haystack: Set<string>): number {
  if (needles.length === 0) return 0;
  const hit = needles.filter((term) => haystack.has(term)).length;
  return hit / needles.length;
}
