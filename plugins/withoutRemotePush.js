// A free Apple ID cannot sign the push entitlement that expo-notifications adds,
// and Paco only uses local notifications. Expo 55 has no switch for this.
const { withEntitlementsPlist } = require('expo/config-plugins');

module.exports = (config) =>
  withEntitlementsPlist(config, (config) => {
    delete config.modResults['aps-environment'];
    return config;
  });
