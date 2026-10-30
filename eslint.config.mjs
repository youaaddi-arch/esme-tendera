import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

// Next 16 fournit sa configuration au format « flat » : on la consomme
// directement, sans passer par la couche de compatibilité eslintrc.
const config = [
  ...coreWebVitals,
  ...typescript,
  { ignores: [".next/**", "node_modules/**", "storage/**", "data-source/**"] },
];

export default config;
