import { colors } from "@xsec/design-tokens";

const variables = (mode: keyof typeof colors) =>
  Object.entries(colors[mode])
    .map(([name, value]) => {
      const key = name.replaceAll(
        /[A-Z]/g,
        (letter) => `-${letter.toLowerCase()}`
      );
      return `--reading-${key}:${value}`;
    })
    .join(";");

// Resolve the system palette in CSS before the client subscribes to preferences.
export const systemThemeCss = `:root{color-scheme:light;${variables("light")}}@media(prefers-color-scheme:dark){:root{color-scheme:dark;${variables("dark")}}}`;
