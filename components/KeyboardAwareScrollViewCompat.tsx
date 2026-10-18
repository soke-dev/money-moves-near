import React from "react";
import { ScrollView, ScrollViewProps, KeyboardAvoidingView, Platform } from "react-native";

type Props = ScrollViewProps & { children?: React.ReactNode };

export function KeyboardAwareScrollViewCompat({
  children,
  keyboardShouldPersistTaps = "handled",
  ...props
}: Props) {
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1 }}
    >
      <ScrollView
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        {...props}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
