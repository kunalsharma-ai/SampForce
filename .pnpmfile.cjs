// The mobile app (apps/mobile) brings Expo and React Native into the workspace. Some web packages list them as
// optional peers (for their own React Native builds), and pnpm would then wire React Native into the web app too.
// The web app never runs on React Native, so those optional peers are dropped here.
const WEB_ONLY = new Set(['@react-three/fiber', '@react-three/drei']);
const NATIVE_PEERS = ['expo', 'expo-asset', 'expo-file-system', 'expo-gl', 'react-native'];

module.exports = {
  hooks: {
    readPackage(pkg) {
      if (WEB_ONLY.has(pkg.name)) {
        for (const peer of NATIVE_PEERS) {
          if (pkg.peerDependencies) delete pkg.peerDependencies[peer];
          if (pkg.peerDependenciesMeta) delete pkg.peerDependenciesMeta[peer];
        }
      }
      return pkg;
    },
  },
};
