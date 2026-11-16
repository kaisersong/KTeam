import React, { useEffect, useState } from "react";
import {
  AccessibilityInfo,
  Platform,
  StyleSheet,
  View,
  useColorScheme,
  type ViewProps,
} from "react-native";
import {
  GlassContainer,
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from "expo-glass-effect";

function useGlass() {
  const [reduce, setReduce] = useState(true);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceTransparencyEnabled().then((value) => {
      if (alive) setReduce(value);
    });
    const listener = AccessibilityInfo.addEventListener(
      "reduceTransparencyChanged",
      setReduce,
    );
    return () => {
      alive = false;
      listener.remove();
    };
  }, []);
  return (
    Platform.OS === "ios" &&
    !reduce &&
    isGlassEffectAPIAvailable() &&
    isLiquidGlassAvailable()
  );
}
/** Native material belongs to the navigation and control layer, keeping content readable. */
export function GlassSurface({
  children,
  style,
  interactive = false,
  ...props
}: ViewProps & { interactive?: boolean }) {
  const available = useGlass(),
    dark = useColorScheme() === "dark";
  return available ? (
    <GlassView
      {...props}
      style={style}
      glassEffectStyle="regular"
      isInteractive={interactive}
    >
      {children}
    </GlassView>
  ) : (
    <View
      {...props}
      style={[
        style,
        {
          backgroundColor: dark ? "#26302a" : "#ffffff",
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: dark ? "#435248" : "#e1e7e0",
        },
      ]}
    >
      {children}
    </View>
  );
}
export function GlassGroup({ children, ...props }: ViewProps) {
  const available = useGlass();
  return available ? (
    <GlassContainer {...props} spacing={12}>
      {children}
    </GlassContainer>
  ) : (
    <View {...props}>{children}</View>
  );
}
