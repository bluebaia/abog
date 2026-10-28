import { defineAstroPaperConfig } from "./src/types/config";
import config from "../.blog/config.json";
import { resolveBlogConfiguration } from "../scripts/blog-config.mjs";

const resolved = resolveBlogConfiguration(config);
export const blogDeployment = resolved.deployment;
export const blogHome = resolved.themeConfig.home;
export default defineAstroPaperConfig(resolved.themeConfig);
