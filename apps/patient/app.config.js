// Adds a base path only when building the web version that lives at /phone on the clinic server.
module.exports = ({ config }) => ({
  ...config,
  experiments: { ...(config.experiments ?? {}), ...(process.env.EXPO_BASE_URL ? { baseUrl: process.env.EXPO_BASE_URL } : {}) },
});
