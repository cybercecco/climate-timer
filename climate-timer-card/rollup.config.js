import resolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

export default {
  input: "src/climate-timer-card.ts",
  output: {
    file: "dist/climate-timer-card.js",
    format: "es",
    inlineDynamicImports: true,
  },
  plugins: [resolve(), typescript()],
};
