import workspaceConfig from "../../eslint.config.js";

export default [
  ...workspaceConfig,
  {
    files: ["app/**/*.{ts,tsx}"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
];
