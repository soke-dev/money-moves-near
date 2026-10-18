import React, { useCallback, useRef, useState } from "react";
import { View, Share } from "react-native";
import { captureRef } from "react-native-view-shot";
import * as Sharing from "expo-sharing";
import { VoucherShareCard, type VoucherCard } from "@/components/VoucherShareCard";

/**
 * Turning a voucher into something you can send.
 *
 * The card is mounted off-screen rather than conditionally: react-native-view-shot
 * captures a real mounted view, so a card rendered only at the moment of
 * capture is captured before its QR has drawn. It sits out of sight the whole
 * time the screen is open, costing one small subtree, and is ready the instant
 * somebody taps.
 *
 * Off-screen, not transparent or zero-sized. `opacity: 0` and `width: 0` both
 * capture as nothing on one platform or the other; moving it beyond the edge
 * leaves it fully laid out and fully rendered, which is what gets captured.
 *
 * Falls back to text. Sharing an image needs a share sheet that accepts files,
 * and if that is unavailable - or the capture fails for any reason - a code
 * somebody can paste is far better than an error about a PNG.
 */
export function useVoucherShare() {
  const cardRef = useRef<View>(null);
  const [card, setCard] = useState<VoucherCard | null>(null);
  const [sharing, setSharing] = useState(false);

  const shareVoucher = useCallback(
    async (v: VoucherCard) => {
      if (sharing) return;
      setSharing(true);
      setCard(v);

      const asText = () =>
        Share.share({
          message: `Claim ${v.amount.toFixed(2)} USDC on Money Moves with this code: ${v.code}`,
        }).catch(() => {});

      try {
        // One frame for the card to mount and the QR to draw. Without it the
        // capture races the render and comes back blank or half-drawn.
        await new Promise((r) => setTimeout(r, 260));

        if (!cardRef.current || !(await Sharing.isAvailableAsync())) {
          await asText();
          return;
        }

        const uri = await captureRef(cardRef, {
          format: "png",
          quality: 1,
          // Sharper than the phone's own density, because this gets viewed at
          // full width in a chat and a 1x capture of a 320pt card is soft.
          result: "tmpfile",
        });

        await Sharing.shareAsync(uri, {
          mimeType: "image/png",
          dialogTitle: "Share this voucher",
          UTI: "public.png",
        });
      } catch {
        await asText();
      } finally {
        setSharing(false);
      }
    },
    [sharing],
  );

  /**
   * Rendered by the screen, somewhere in its tree. Nothing is visible; it is
   * parked past the left edge so it lays out properly and captures properly.
   */
  const shareCard = card ? (
    <View style={{ position: "absolute", left: -10000, top: 0 }} pointerEvents="none">
      <VoucherShareCard ref={cardRef} voucher={card} />
    </View>
  ) : null;

  return { shareVoucher, shareCard, sharing };
}
