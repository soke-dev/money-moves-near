import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Platform,
  Image,
  ActionSheetIOS,
  Modal,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import * as ImagePicker from "expo-image-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  uploadAvatar,
  deleteAvatar,
  getProfile,
  requestAccountDeletion,
  cancelAccountDeletion,
  avatarKey,
} from "@/services/user";
import { getServerUrl } from "@/services/api";

/**
 * One profile field.
 *
 * An unset value used to render as nothing at all - "Full name" with empty
 * space under it, which reads as a failed load rather than a blank field. It
 * now says so, and says whether you can do anything about it.
 */
function Field({
  label,
  value,
  colors,
  onPress,
  locked,
  last,
  hint,
}: {
  label: string;
  value: string | null;
  colors: any;
  onPress?: () => void;
  locked?: boolean;
  last?: boolean;
  /**
   * Stands in for the placeholder when the field is empty, for a field whose
   * purpose is not obvious. It replaces that line rather than adding one:
   * label, value and a note made three rows of a row.
   */
  hint?: string;
}) {
  const body = (
    <>
      <View style={{ flex: 1 }}>
        <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{label}</Text>
        <Text
          style={[
            styles.fieldValue,
            { color: value ? colors.foreground : colors.mutedForeground },
            !value && styles.fieldEmpty,
          ]}
          numberOfLines={1}
        >
          {value ?? hint ?? (locked ? "Not set" : "Add")}
        </Text>
      </View>
      {locked ? (
        // The drawn mark rather than the icon font, tinted so it sits in the
        // same column as every other glyph in the app.
        <Image
          source={require("@/assets/images/lock.png")}
          style={[styles.lockMark, { tintColor: colors.mutedForeground }]}
          resizeMode="contain"
        />
      ) : (
        <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
      )}
    </>
  );

  const style = [
    styles.fieldRow,
    !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  ];

  // A locked row is not a button, so it does not get a press state.
  return locked || !onPress ? (
    <View style={style}>{body}</View>
  ) : (
    <TouchableOpacity style={style} onPress={onPress} activeOpacity={0.7}>
      {body}
    </TouchableOpacity>
  );
}

export default function ProfileScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, updateUser } = useApp();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  const [avatar, setAvatar] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  /** Set while a closure request is open, so the page can say so. */
  const [requestedAt, setRequestedAt] = useState<string | null>(null);

  useEffect(() => {
    getProfile()
      .then((p) => setRequestedAt(p.deletionRequestedAt ?? null))
      .catch(() => {});
  }, []);

  useEffect(() => {
    // Prefer backend avatar, fall back to local
    if (user?.avatarUrl) {
      const u = user.avatarUrl;
      // DB-stored avatars are data URIs; only legacy relative paths need the prefix.
      setAvatar(u.startsWith("data:") || u.startsWith("http") ? u : `${getServerUrl()}${u}`);
    } else {
      AsyncStorage.getItem(avatarKey(user?.id)).then((uri) => {
        if (uri) setAvatar(uri);
      });
    }
  }, [user?.avatarUrl]);

  const pickImage = async (source: "camera" | "library") => {
    const opts: ImagePicker.ImagePickerOptions = {
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    };
    const result =
      source === "camera"
        ? await ImagePicker.launchCameraAsync(opts)
        : await ImagePicker.launchImageLibraryAsync(opts);
    if (!result.canceled && result.assets[0]) {
      const uri = result.assets[0].uri;
      // Optimistically preview, but only persist after the upload succeeds —
      // otherwise a dead blob: URL leaks into storage on web.
      setAvatar(uri);
      try {
        const { avatarUrl } = await uploadAvatar(uri);
        // avatarUrl is now a base64 data URI from the server — use as-is.
        const fullUrl = avatarUrl.startsWith("data:") || avatarUrl.startsWith("http")
          ? avatarUrl
          : `${getServerUrl()}${avatarUrl}`;
        setAvatar(fullUrl);
        await AsyncStorage.setItem(avatarKey(user?.id), fullUrl);
        await updateUser({ avatarUrl });
      } catch (err: any) {
        console.error("[avatar upload]", err);
        setAvatar(null);
        await AsyncStorage.removeItem(avatarKey(user?.id));
        Alert.alert("Upload failed", err?.message || "Could not upload your photo. Please try again.");
      }
    }
  };

  const handleRemoveAvatar = async () => {
    setAvatar(null);
    await AsyncStorage.removeItem(avatarKey(user?.id));
    try { await deleteAvatar(); await updateUser({ avatarUrl: null }); } catch {}
  };

  const handleAvatarPress = () => {
    if (Platform.OS === "web") {
      // Alert.alert is a no-op on react-native-web. Use the browser's native
      // confirm to offer replace vs. remove; otherwise go straight to picker.
      if (avatar) {
        const replace = window.confirm(
          "Click OK to upload a new photo, or Cancel to remove the current one."
        );
        if (replace) pickImage("library");
        else handleRemoveAvatar();
      } else {
        pickImage("library");
      }
      return;
    }
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Cancel", "Take Photo", "Choose from Library", ...(avatar ? ["Remove Photo"] : [])],
          cancelButtonIndex: 0,
          destructiveButtonIndex: avatar ? 3 : undefined,
        },
        async (idx) => {
          if (idx === 1) pickImage("camera");
          else if (idx === 2) pickImage("library");
          else if (idx === 3) handleRemoveAvatar();
        }
      );
    } else {
      Alert.alert("Profile Photo", "Choose an option", [
        { text: "Take Photo", onPress: () => pickImage("camera") },
        { text: "Choose from Library", onPress: () => pickImage("library") },
        ...(avatar ? [{ text: "Remove Photo", style: "destructive" as const, onPress: handleRemoveAvatar }] : []),
        { text: "Cancel", style: "cancel" as const },
      ]);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>My Profile</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.avatarSection}>
          <TouchableOpacity onPress={handleAvatarPress} activeOpacity={0.8}>
            <View style={[styles.avatar, { backgroundColor: colors.muted }]}>
              {avatar ? (
                <Image
                  source={{ uri: avatar }}
                  style={styles.avatarImg}
                  resizeMode="cover"
                  onError={() => {
                    // File missing on the server - drop back to the placeholder
                    // rather than showing a broken image.
                    setAvatar(null);
                    AsyncStorage.removeItem(avatarKey(user?.id)).catch(() => {});
                  }}
                />
              ) : (
                /* A glyph, not anon.png: that artwork is a black silhouette on
                   an opaque white square, so clipped to a circle on a dark
                   screen it reads as a white disc with a blob in it. A glyph
                   centres in the circle and follows the theme. */
                <Feather name="user" size={42} color={colors.mutedForeground} />
              )}
            </View>
            <View style={[styles.cameraBadge, { backgroundColor: colors.muted, borderColor: colors.background }]}>
              {/* A gallery mark here, not a pencil: this badge opens the
                  picker. The one on the Account tab stays an edit mark because
                  it navigates to this screen rather than choosing a file. */}
              <Image
                source={require("@/assets/images/image.png")}
                style={[styles.badgeMark, { tintColor: colors.foreground }]}
                resizeMode="contain"
              />
            </View>
          </TouchableOpacity>

          {/* The name belongs here. The page was titled "My Profile" and then
              showed a card of fields without ever saying whose. */}
          <View style={styles.nameRow}>
            <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
              {[user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.username}
            </Text>
            {user?.verified && (
              <Image
                source={require("@/assets/images/checklist-green.png")}
                style={styles.verifiedMark}
                resizeMode="contain"
              />
            )}
          </View>

          {!user?.verified && (
            <TouchableOpacity
              style={[styles.kycNudge, { borderColor: "#f59e0b55" }]}
              onPress={() => router.push("/account/kyc")}
              activeOpacity={0.75}
            >
              <Feather name="alert-circle" size={13} color="#f59e0b" />
              <Text style={[styles.kycNudgeText, { color: "#f59e0b" }]}>Complete KYC</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={[styles.infoCard, { backgroundColor: colors.card }]}>
          <Field
            label="Username"
            value={user?.username ? `@${user.username}` : null}
            colors={colors}
            onPress={() => router.push("/account/edit-username" as any)}
          />
          {/* Never typed in. The name comes off the identity document and
              nowhere else, because it is what a naira deposit is checked
              against before any crypto is released - a name someone could set
              themselves would let them name the account they wanted to fund
              from. Blank until they verify, and it says so rather than
              inviting an edit that will not be accepted. */}
          <Field
            label="Full name"
            value={[user?.firstName, user?.lastName].filter(Boolean).join(" ") || null}
            colors={colors}
            locked
            hint="Set from your ID when you verify"
          />
          <Field label="Email address" value={user?.email || null} colors={colors} locked />
          <Field
            label="Phone number"
            value={user?.phone || null}
            colors={colors}
            onPress={() => router.push("/account/edit-phone" as any)}
            last
          />
        </View>

        {requestedAt ? (
          /* An open request, and the two things the user needs to know: it is
             not done yet, and the account still works. */
          <View style={[styles.pendingCard, { borderColor: "#f59e0b55", backgroundColor: "#f59e0b12" }]}>
            <Feather name="clock" size={15} color="#f59e0b" />
            <View style={{ flex: 1 }}>
              <Text style={[styles.pendingTitle, { color: "#f59e0b" }]}>Deletion requested</Text>
              <Text style={[styles.pendingText, { color: colors.mutedForeground }]}>
                Sent {new Date(requestedAt).toLocaleDateString()}. Support will reach out. Your
                account works as normal until it is closed.
              </Text>
              <TouchableOpacity
                onPress={async () => {
                  setDeleting(true);
                  try {
                    await cancelAccountDeletion();
                    setRequestedAt(null);
                  } catch {
                    Alert.alert("Error", "Could not cancel the request. Try again.");
                  } finally {
                    setDeleting(false);
                  }
                }}
                disabled={deleting}
                activeOpacity={0.7}
                style={styles.pendingCancel}
              >
                <Text style={[styles.pendingCancelText, { color: colors.foreground }]}>
                  {deleting ? "Cancelling..." : "Cancel request"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          /* A quiet link, not a bordered button parked at the bottom of the
             screen. Closing an account is rare; it should be findable, not
             prominent. */
          <TouchableOpacity
            style={styles.deleteLink}
            onPress={() => setShowDeleteModal(true)}
            activeOpacity={0.7}
          >
            <Text style={[styles.deleteLinkText, { color: colors.destructive }]}>
              Request account deletion
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* A sheet, the way the rest of the app asks things. The centred card
          with a red badge and a warning box nested inside it was shouting, and
          this is a request now rather than a deletion. */}
      <Modal visible={showDeleteModal} transparent animationType="slide">
        <TouchableOpacity
          style={styles.sheetOverlay}
          activeOpacity={1}
          onPress={() => { setShowDeleteModal(false); setAccepted(false); }}
        >
          <View
            style={[styles.sheet, { backgroundColor: colors.background, paddingBottom: bottomPad + 20 }]}
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.sheetHead}>
              <Text style={[styles.sheetTitle, { color: colors.foreground }]}>
                Request account deletion
              </Text>
              <TouchableOpacity
                style={[styles.sheetClose, { backgroundColor: colors.muted }]}
                onPress={() => { setShowDeleteModal(false); setAccepted(false); }}
                hitSlop={10}
              >
                <Feather name="x" size={17} color={colors.foreground} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.sheetLead, { color: colors.mutedForeground }]}>
              Support reviews every request. Nothing closes today, and your account keeps working
              until it does.
            </Text>

            {/* The one part of this that cannot be undone afterwards. */}
            <View style={[styles.warnCard, { backgroundColor: colors.card }]}>
              <View style={styles.warnHead}>
                <View style={[styles.warnIcon, { backgroundColor: colors.destructive + "1A" }]}>
                  <Feather name="alert-triangle" size={15} color={colors.destructive} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.warnTitle, { color: colors.foreground }]}>
                    Your wallet goes with it
                  </Text>
                  <Text style={[styles.warnText, { color: colors.mutedForeground }]}>
                    Back up or export your recovery phrase first. Without it, anything still in the
                    wallet is gone for good.
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                style={[styles.warnAction, { borderTopColor: colors.border }]}
                onPress={() => {
                  setShowDeleteModal(false);
                  setAccepted(false);
                  router.push("/account/export-wallet" as any);
                }}
                activeOpacity={0.7}
              >
                <Text style={[styles.warnActionText, { color: colors.primary }]}>Export wallet</Text>
                <Feather name="chevron-right" size={16} color={colors.primary} />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.agreeRow}
              onPress={() => setAccepted((prev) => !prev)}
              activeOpacity={0.7}
            >
              <View
                style={[
                  styles.agreeBox,
                  {
                    borderColor: accepted ? colors.destructive : colors.border,
                    backgroundColor: accepted ? colors.destructive : "transparent",
                  },
                ]}
              >
                {accepted && <Feather name="check" size={13} color="#fff" />}
              </View>
              <Text style={[styles.agreeText, { color: colors.foreground }]}>
                I understand my account and wallet access will be closed
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: accepted ? colors.destructive : colors.muted }]}
              disabled={deleting || !accepted}
              activeOpacity={0.85}
              onPress={async () => {
                setDeleting(true);
                try {
                  const r = await requestAccountDeletion();
                  setRequestedAt(r.deletionRequestedAt);
                  setShowDeleteModal(false);
                  setAccepted(false);
                  // The sheet owns the screen while it is up, so an alert fired
                  // in the same tick can end up presented behind it.
                  setTimeout(() => {
                    Alert.alert(
                      "Request sent",
                      "We will review it and get in touch. Your account keeps working until then.",
                    );
                  }, 350);
                } catch {
                  Alert.alert("Error", "Could not send your request. Please try again.");
                } finally {
                  setDeleting(false);
                }
              }}
            >
              {deleting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text
                  style={[styles.primaryBtnText, { color: accepted ? "#fff" : colors.mutedForeground }]}
                >
                  Send request
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => { setShowDeleteModal(false); setAccepted(false); }}
              disabled={deleting}
              activeOpacity={0.7}
            >
              <Text style={[styles.secondaryBtnText, { color: colors.mutedForeground }]}>Not now</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  avatarSection: { alignItems: "center", paddingTop: 18, paddingBottom: 22 },
  avatar: { width: 96, height: 96, borderRadius: 48, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  avatarImg: { width: "100%", height: "100%" },
  cameraBadge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeMark: { width: 14, height: 14 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 14, paddingHorizontal: 24 },
  name: { fontSize: 19, lineHeight: 25, fontFamily: "Inter_700Bold", letterSpacing: -0.3, flexShrink: 1 },
  verifiedMark: { width: 17, height: 17 },
  // Outlined rather than filled: a warning that is not an error.
  kycNudge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginTop: 10,
  },
  kycNudgeText: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_600SemiBold" },

  infoCard: { marginHorizontal: 16, borderRadius: 18, paddingHorizontal: 16 },
  fieldRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 15 },
  fieldLabel: { fontSize: 12, lineHeight: 16, fontFamily: "Inter_400Regular" },
  fieldValue: { fontSize: 15, lineHeight: 20, fontFamily: "Inter_600SemiBold", marginTop: 3 },
  // Lighter, so a placeholder never passes for a real value.
  lockMark: { width: 15, height: 15 },
  fieldEmpty: { fontFamily: "Inter_400Regular" },

  pendingCard: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginHorizontal: 16,
    marginTop: 24,
  },
  pendingTitle: { fontSize: 13.5, lineHeight: 18, fontFamily: "Inter_700Bold" },
  pendingText: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular", marginTop: 3 },
  pendingCancel: { alignSelf: "flex-start", paddingVertical: 8, paddingRight: 8 },
  pendingCancelText: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_600SemiBold", textDecorationLine: "underline" },

  deleteLink: { alignSelf: "center", paddingVertical: 16, marginTop: 26 },
  deleteLinkText: { fontSize: 13.5, lineHeight: 18, fontFamily: "Inter_600SemiBold" },

  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  title: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  content: { padding: 20, gap: 24 },
  sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 16, paddingTop: 18 },
  sheetHead: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  sheetTitle: { flex: 1, fontSize: 19, lineHeight: 25, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.4 },
  sheetClose: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  sheetLead: { fontSize: 13, lineHeight: 19, fontFamily: "Inter_400Regular", marginTop: 8, paddingRight: 8 },

  warnCard: { borderRadius: 18, paddingHorizontal: 14, paddingTop: 14, marginTop: 18 },
  warnHead: { flexDirection: "row", gap: 11 },
  warnIcon: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  warnTitle: { fontSize: 13.5, lineHeight: 18, fontFamily: "Inter_700Bold" },
  warnText: { fontSize: 12.5, lineHeight: 18, fontFamily: "Inter_400Regular", marginTop: 3 },
  // A seam across the card, rather than a button boxed inside a box.
  warnAction: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 13,
    marginHorizontal: -14,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  warnActionText: { fontSize: 13.5, lineHeight: 18, fontFamily: "Inter_600SemiBold" },

  agreeRow: { flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 18 },
  agreeBox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  agreeText: { flex: 1, fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular" },

  primaryBtn: { height: 54, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  primaryBtnText: { fontSize: 15.5, lineHeight: 21, fontFamily: "Inter_600SemiBold" },
  // Text, not a second filled button: leaving is the easy path and does not
  // need to compete with the one that matters.
  secondaryBtn: { height: 48, alignItems: "center", justifyContent: "center", marginTop: 2 },
  secondaryBtnText: { fontSize: 14.5, lineHeight: 20, fontFamily: "Inter_600SemiBold" },
});
