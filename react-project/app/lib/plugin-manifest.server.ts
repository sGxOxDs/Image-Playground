export const pluginName = process.env.LITELLM_PLUGIN_NAME || "image-studio";

export const pluginManifest = {
  name: pluginName, display_name: "Image Studio", version: "1.0.0",
  nav_items: [{ key: "home", label: "Image Studio", icon: "PictureOutlined", path: "/" }],
  capabilities: ["image-generation", "image-editing", "image-comparison", "conversation-history"],
};
