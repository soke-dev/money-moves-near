import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, requireActiveSession } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { sendPushOnly } from "../lib/push";
import { sendHumanAgentRequestEmail } from "../lib/email";
import { env } from "../config/env";
import path from "path";
import fs from "fs";
import multer from "multer";

const router = Router();

// ─── Image upload for chat ──────────────────────────────────
/**
 * Under UPLOADS_DIR, the same root /uploads is served from.
 *
 * This was a path beside the code, which is the container's own disk: on
 * Railway that is wiped by every deploy, and it is not where index.ts serves
 * from once UPLOADS_DIR points at the volume - so every image anyone sent
 * support was a 404 from the moment it was written.
 */
const uploadDir = path.join(process.env.UPLOADS_DIR || path.join(__dirname, "../../uploads"), "chat");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    const allowed = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
    if (!allowed.includes(ext.toLowerCase())) return cb(new Error("Invalid file type"), "");
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB max

// ─── BOT Welcome Message ────────────────────────────────────
// The scam warning used to live at the bottom of this message, where it
// scrolled away with the greeting. The app pins it under the header instead,
// so it is on screen for the whole conversation.
const WELCOME_MESSAGE = `Hi, welcome to Money Moves support.

We usually reply within a few minutes. Pick one of the options below, or just tell us what is going on.`;

const QUICK_OPTIONS = [
  { label: "Transaction issues", value: "transaction_issues" },
  { label: "Identity verification", value: "kyc_help" },
  { label: "Deposit not showing", value: "deposit_help" },
  { label: "Account and security", value: "account_security" },
  { label: "Adding money", value: "buy_help" },
  { label: "Bank payouts", value: "sell_help" },
  { label: "Sending crypto", value: "send_help" },
  { label: "Savings", value: "savings_help" },
  { label: "Airtime and bills", value: "bills_help" },
  { label: "Loyalty and referrals", value: "referral_help" },
  { label: "Fees and limits", value: "fees_limits" },
  { label: "Talk to a person", value: "connect_human" },
];

/**
 * What the bot answers with, in the app's own words.
 *
 * Every route named here is one that exists today: Add money, Send money, Pay
 * bills, Account > Transaction limits. The old set still sent people to Buy,
 * Sell, Withdraw and a Change Password screen, and promised referral points
 * could be withdrawn as naira, which they cannot.
 */
const QUICK_REPLIES: Record<string, string> = {
  transaction_issues: `For a transaction that looks stuck:\n\n• Open Transactions and check the status - filter by type or period to find it\n• Bank payouts are usually instant, but can take up to 24 hours during bank maintenance\n• A failed one is usually balance or a daily cap: Account > Transaction limits shows what you have used today\n\nStill wrong? Tap "Talk to a person" and we will look it up with you.`,
  kyc_help: `Identity verification:\n\n• Account > Identity verification starts it\n• You need a valid government ID, a face match and a liveness check\n• Our verification partner runs it and holds the documents - they do not come to us\n• Most results land within minutes\n\nFailures are nearly always the photo: glare, a cropped corner, or a worn document. Try again in better light with all four corners in frame.`,
  deposit_help: `A deposit that has not shown up:\n\n• Crypto needs a few block confirmations first\n• Check you sent to the right address AND the right chain - the wrong chain can lose the funds\n• Naira deposits land once the bank transfer clears\n\nAfter 30 minutes, tap "Talk to a person" with your transaction hash or transfer reference.`,
  account_security: `Account and security:\n\n• Signing in uses a code we email you - there is no password on the account\n• Change PIN: Account > Security > Change PIN\n• Forgot your PIN: tap "Forgot PIN?" on the unlock screen\n• Biometrics: Account > Security, one switch for unlocking and one for approving payments\n• Your keys: Account > Security > Export wallet\n\nIf you think someone else is in your account, tap "Talk to a person" now.`,
  buy_help: `Adding money with naira:\n\n• Tap Add money, then Deposit fiat\n• Enter the naira amount and pick the token and chain\n• Transfer that amount from your bank to the account number shown\n• The crypto lands in your wallet once the transfer clears\n\nThere is a 1% fee, and this one needs your identity verified.\n\nPaid but nothing arrived after 15 minutes? Tap "Talk to a person" with the reference.`,
  sell_help: `Sending naira to a bank:\n\n• Tap Send money, then Bank Transfer\n• Pick a saved account or add one, then enter the amount\n• Confirm with your PIN - payouts are usually instant\n\nThe fee is 0.5% plus ₦50 processing, shown before you confirm.\n\nBank maintenance can delay a payout up to 24 hours. Past that, tap "Talk to a person".`,
  send_help: `Sending and receiving crypto:\n\n• To another Money Moves user: Send money > Send to Username. Instant, free, no limit\n• To any wallet: Send money > Crypto Transfer. Scan or paste the address and pick the chain\n• Double-check the chain - the wrong one can lose the funds\n• To receive: Add money > Deposit crypto gives you an address and QR code\n\nAddresses you send to are saved under Account > Beneficiaries, so you only type them once.`,
  savings_help: `Savings:\n\n• Open Savings and lock USDC or USDT for 7 days, 30 days, 3 months, 6 months, or a length you choose\n• A 0.5% lock fee is charged when you lock\n• The tokens stay in the on-chain vault until the unlock date\n• There is no early unlock, so pick the term carefully\n\nYou get a notification when a lock matures.`,
  bills_help: `Airtime, data and electricity:\n\n• Tap Pay bills on the home screen and pick what you are paying\n• Choose the network or disco, then enter the phone or meter number\n• It is paid from your crypto balance at the live rate\n• Electricity tokens appear on the success screen and in the transaction receipt\n\nCable TV is not live yet.\n\nNothing delivered after 5 minutes? Tap "Talk to a person" with the reference.`,
  referral_help: `Loyalty and referrals:\n\n• Your code and link are in Account > Loyalty and Referral\n• You earn a point for every ₦100 of volume you move\n• Points set your place on the leaderboard and unlock rewards as they launch\n\nPoints are not cash and cannot be withdrawn.`,
  fees_limits: `Fees:\n\n• Deposits: free\n• Bank transfer: 0.5% plus ₦50 processing\n• Adding money with naira: 1%\n• Crypto transfers: free, and we cover the gas\n• Sending to a Money Moves username: free\n• Savings lock: 0.5% once\n• Airtime, data and electricity: free\n\nLimits depend on whether you are verified. Account > Transaction limits shows Basic and Verified side by side, and what you have used today.`,
};

// ─── GET /chat/conversations — List user's conversations ────
router.get(
  "/conversations",
  requireAuth,
  requireActiveSession,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const convos = await prisma.chatConversation.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        include: {
          messages: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 1 },
        },
      });

      const result = convos.map((c) => ({
        id: c.id,
        status: c.status,
        needsHuman: c.needsHuman,
        lastMessage: c.messages[0]?.text || (c.messages[0]?.imageUrl ? "📷 Image" : ""),
        lastMessageAt: c.messages[0]?.createdAt || c.createdAt,
        createdAt: c.createdAt,
      }));

      res.json({ conversations: result });
    } catch (err) {
      console.error("List conversations error:", err);
      res.status(500).json({ error: "Failed to load conversations" });
    }
  }
);

// ─── POST /chat/conversations — Create new conversation ─────
router.post(
  "/conversations",
  requireAuth,
  requireActiveSession,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;

      // Limit open conversations to 3
      const openCount = await prisma.chatConversation.count({
        where: { userId, status: "OPEN" },
      });
      if (openCount >= 3) {
        res.status(400).json({ error: "You already have 3 open conversations. Please resolve one first." });
        return;
      }

      const convo = await prisma.chatConversation.create({
        data: {
          userId,
          messages: {
            create: {
              sender: "BOT",
              text: WELCOME_MESSAGE,
            },
          },
        },
        include: { messages: true },
      });

      res.json({
        conversation: {
          id: convo.id,
          status: convo.status,
          needsHuman: convo.needsHuman,
          messages: convo.messages.map(formatMessage),
          quickOptions: QUICK_OPTIONS,
        },
      });
    } catch (err) {
      console.error("Create conversation error:", err);
      res.status(500).json({ error: "Failed to create conversation" });
    }
  }
);

// ─── GET /chat/conversations/:id — Get conversation with messages ─
router.get(
  "/conversations/:id",
  requireAuth,
  requireActiveSession,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const id = req.params.id as string;
      const convo = await prisma.chatConversation.findFirst({
        where: { id, userId },
        include: {
          messages: { where: { deletedAt: null }, orderBy: { createdAt: "asc" } },
        },
      });

      if (!convo) {
        res.status(404).json({ error: "Conversation not found" });
        return;
      }

      res.json({
        conversation: {
          id: convo.id,
          status: convo.status,
          needsHuman: convo.needsHuman,
          messages: (convo as any).messages.map(formatMessage),
          quickOptions: convo.needsHuman ? [] : QUICK_OPTIONS,
        },
      });
    } catch (err) {
      console.error("Get conversation error:", err);
      res.status(500).json({ error: "Failed to load conversation" });
    }
  }
);

// ─── POST /chat/conversations/:id/messages — Send a message ─
const sendMessageSchema = z.object({
  text: z.string().max(1000).optional(),
  quickOption: z.string().optional(),
});

router.post(
  "/conversations/:id/messages",
  requireAuth,
  requireActiveSession,
  validate(sendMessageSchema),
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const id = req.params.id as string;
      const { text, quickOption } = req.body;

      const convo = await prisma.chatConversation.findFirst({
        where: { id, userId, status: "OPEN" },
      });
      if (!convo) {
        res.status(404).json({ error: "Conversation not found or already resolved" });
        return;
      }

      const messages = [];

      // Handle quick option selection
      if (quickOption) {
        if (quickOption === "connect_human") {
          // User wants a human agent
          const wasAlreadyNeedsHuman = convo.needsHuman;
          const userMsg = await prisma.chatMessage.create({
            data: { conversationId: convo.id, sender: "USER", text: "I'd like to connect with a human agent" },
          });
          messages.push(formatMessage(userMsg));

          await prisma.chatConversation.update({
            where: { id: convo.id },
            data: { needsHuman: true, updatedAt: new Date() },
          });

          const botMsg = await prisma.chatMessage.create({
            data: {
              conversationId: convo.id,
              sender: "BOT",
              text: "You're now connected to our support queue. A human agent will be with you shortly. Please describe your issue and we'll get back to you as soon as possible. 🙏",
            },
          });
          messages.push(formatMessage(botMsg));

          // Notify admins by email — fire-and-forget, only on first escalation
          if (!wasAlreadyNeedsHuman && env.ADMIN_EMAIL.length > 0) {
            prisma.user
              .findUnique({
                where: { id: userId },
                select: { email: true, username: true, firstName: true, lastName: true },
              })
              .then((u) => {
                if (!u) return;
                const fullName = [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.username || u.email;
                return sendHumanAgentRequestEmail(env.ADMIN_EMAIL, {
                  userEmail: u.email,
                  userName: fullName,
                  username: u.username,
                  conversationId: convo.id,
                  date: new Date().toLocaleString("en-NG", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" }),
                });
              })
              .catch((err) => {
                console.error("[CHAT] admin human-agent notify failed:", err?.message || err);
              });
          }

          res.json({ messages, needsHuman: true, quickOptions: [] });
          return;
        }

        // Auto-reply for other quick options
        const label = QUICK_OPTIONS.find((o) => o.value === quickOption)?.label || quickOption;
        const userMsg = await prisma.chatMessage.create({
          data: { conversationId: convo.id, sender: "USER", text: label },
        });
        messages.push(formatMessage(userMsg));

        const reply = QUICK_REPLIES[quickOption];
        if (reply) {
          const botMsg = await prisma.chatMessage.create({
            data: { conversationId: convo.id, sender: "BOT", text: reply },
          });
          messages.push(formatMessage(botMsg));
        }

        await prisma.chatConversation.update({
          where: { id: convo.id },
          data: { updatedAt: new Date() },
        });

        res.json({ messages, needsHuman: convo.needsHuman, quickOptions: QUICK_OPTIONS });
        return;
      }

      // Regular text message
      if (!text?.trim()) {
        res.status(400).json({ error: "Message text is required" });
        return;
      }

      const userMsg = await prisma.chatMessage.create({
        data: { conversationId: convo.id, sender: "USER", text: text.trim() },
      });
      messages.push(formatMessage(userMsg));

      await prisma.chatConversation.update({
        where: { id: convo.id },
        data: { updatedAt: new Date() },
      });

      // If no human is connected yet, prompt them
      if (!convo.needsHuman) {
        const botMsg = await prisma.chatMessage.create({
          data: {
            conversationId: convo.id,
            sender: "BOT",
            text: "Thanks for your message! If the quick options above don't help, tap \"Connect to Human Agent\" and our team will assist you directly.",
          },
        });
        messages.push(formatMessage(botMsg));
      }

      res.json({ messages, needsHuman: convo.needsHuman, quickOptions: convo.needsHuman ? [] : QUICK_OPTIONS });
    } catch (err) {
      console.error("Send message error:", err);
      res.status(500).json({ error: "Failed to send message" });
    }
  }
);

// ─── POST /chat/conversations/:id/image — Send an image ────
router.post(
  "/conversations/:id/image",
  requireAuth,
  requireActiveSession,
  upload.single("image"),
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const id = req.params.id as string;
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "No image provided" });
        return;
      }

      const convo = await prisma.chatConversation.findFirst({
        where: { id, userId, status: "OPEN" },
      });
      if (!convo) {
        res.status(404).json({ error: "Conversation not found or already resolved" });
        return;
      }

      const imageUrl = `/uploads/chat/${file.filename}`;
      const caption = typeof req.body.text === "string" ? req.body.text.trim().slice(0, 500) : null;

      const msg = await prisma.chatMessage.create({
        data: {
          conversationId: convo.id,
          sender: "USER",
          text: caption || null,
          imageUrl,
        },
      });

      await prisma.chatConversation.update({
        where: { id: convo.id },
        data: { updatedAt: new Date() },
      });

      res.json({ message: formatMessage(msg) });
    } catch (err) {
      console.error("Send image error:", err);
      res.status(500).json({ error: "Failed to send image" });
    }
  }
);

// ─── GET /chat/conversations/:id/poll — Poll for new messages ─
router.get(
  "/conversations/:id/poll",
  requireAuth,
  requireActiveSession,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const id = req.params.id as string;
      const since = req.query.since as string;

      const convo = await prisma.chatConversation.findFirst({
        where: { id, userId },
      });
      if (!convo) {
        res.status(404).json({ error: "Conversation not found" });
        return;
      }

      /**
       * Changed since, not created since.
       *
       * Support can now rewrite or withdraw a reply, and neither of those moves
       * created_at - so a cursor on it would hand the client new messages and
       * quietly never mention that an old one had changed underneath them.
       *
       * Deleted messages are included on purpose: an app already showing one
       * needs to be told, and the row it gets back carries no content.
       */
      const where: any = { conversationId: convo.id };
      if (since) {
        where.updatedAt = { gt: new Date(since) };
      }

      const messages = await prisma.chatMessage.findMany({
        where,
        orderBy: { updatedAt: "asc" },
      });

      res.json({
        messages: messages.map(formatMessage),
        status: convo.status,
        needsHuman: convo.needsHuman,
      });
    } catch (err) {
      console.error("Poll messages error:", err);
      res.status(500).json({ error: "Failed to poll messages" });
    }
  }
);

// ─── POST /chat/conversations/:id/resolve — User resolves ───
router.post(
  "/conversations/:id/resolve",
  requireAuth,
  requireActiveSession,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const id = req.params.id as string;
      const convo = await prisma.chatConversation.findFirst({
        where: { id, userId },
      });
      if (!convo) {
        res.status(404).json({ error: "Conversation not found" });
        return;
      }

      await prisma.chatConversation.update({
        where: { id: convo.id },
        data: { status: "RESOLVED" },
      });

      res.json({ success: true });
    } catch (err) {
      console.error("Resolve conversation error:", err);
      res.status(500).json({ error: "Failed to resolve conversation" });
    }
  }
);

// ════════════════════════════════════════════════════════════
// ADMIN ENDPOINTS (protected by admin auth in admin.ts)
// These are mounted under /api/admin/chat by admin routes
// ════════════════════════════════════════════════════════════
const adminRouter = Router();

// ─── GET /admin-conversations — All conversations for admin ─
adminRouter.get("/conversations", async (req: Request, res: Response) => {
  try {
    const status = (req.query.status as string) || "OPEN";
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = 20;

    const where: any = {};
    if (status === "OPEN") where.status = "OPEN";
    else if (status === "RESOLVED") where.status = "RESOLVED";
    else if (status === "NEEDS_HUMAN") {
      where.status = "OPEN";
      where.needsHuman = true;
    }

    const [convos, total] = await Promise.all([
      prisma.chatConversation.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: { select: { id: true, email: true, username: true, firstName: true, lastName: true } },
          messages: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 1 },
        },
      }),
      prisma.chatConversation.count({ where }),
    ]);

    const needsHumanCount = await prisma.chatConversation.count({
      where: { status: "OPEN", needsHuman: true },
    });

    res.json({
      conversations: convos.map((c) => ({
        id: c.id,
        status: c.status,
        needsHuman: c.needsHuman,
        user: c.user,
        lastMessage: c.messages[0]?.text || (c.messages[0]?.imageUrl ? "📷 Image" : ""),
        lastMessageSender: c.messages[0]?.sender || "BOT",
        lastMessageAt: c.messages[0]?.createdAt || c.createdAt,
        createdAt: c.createdAt,
      })),
      pagination: { page, pages: Math.ceil(total / limit), total },
      needsHumanCount,
    });
  } catch (err) {
    console.error("Admin list conversations error:", err);
    res.status(500).json({ error: "Failed to load conversations" });
  }
});

// ─── GET /admin-conversations/:id — Admin view conversation ─
adminRouter.get("/conversations/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const convo = await prisma.chatConversation.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, email: true, username: true, firstName: true, lastName: true, kycStatus: true, createdAt: true } },
        messages: { where: { deletedAt: null }, orderBy: { createdAt: "asc" } },
      },
    });

    if (!convo) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    res.json({
      conversation: {
        id: convo.id,
        status: convo.status,
        needsHuman: convo.needsHuman,
        user: (convo as any).user,
        messages: (convo as any).messages.map(formatForAdmin),
        createdAt: convo.createdAt,
      },
    });
  } catch (err) {
    console.error("Admin get conversation error:", err);
    res.status(500).json({ error: "Failed to load conversation" });
  }
});

// ─── POST /admin-conversations/:id/reply — Admin sends reply ─
const adminReplySchema = z.object({ text: z.string().min(1).max(2000) });

adminRouter.post(
  "/conversations/:id/reply",
  validate(adminReplySchema),
  async (req: Request, res: Response) => {
    try {
      const { text } = req.body;
      const id = req.params.id as string;
      const convo = await prisma.chatConversation.findUnique({ where: { id } });
      if (!convo) {
        res.status(404).json({ error: "Conversation not found" });
        return;
      }

      const msg = await prisma.chatMessage.create({
        data: {
          conversationId: convo.id,
          sender: "ADMIN",
          text: text.trim(),
        },
      });

      await prisma.chatConversation.update({
        where: { id: convo.id },
        data: { updatedAt: new Date() },
      });

      // Send push notification to the user
      sendPushOnly({
        userId: convo.userId,
        type: "chat",
        title: "Support Reply",
        body: text.trim().length > 100 ? text.trim().slice(0, 97) + "..." : text.trim(),
      }).catch(() => {}); // fire-and-forget

      res.json({ message: formatForAdmin(msg) });
    } catch (err) {
      console.error("Admin reply error:", err);
      res.status(500).json({ error: "Failed to send reply" });
    }
  }
);

// ─── POST /admin-conversations/:id/resolve — Admin resolves ─
adminRouter.post("/conversations/:id/resolve", async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const convo = await prisma.chatConversation.findUnique({ where: { id } });
    if (!convo) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    await prisma.chatMessage.create({
      data: {
        conversationId: convo.id,
        sender: "BOT",
        text: "This conversation has been marked as resolved by our support team. If you need further help, feel free to start a new chat. 🙏",
      },
    });

    await prisma.chatConversation.update({
      where: { id: convo.id },
      data: { status: "RESOLVED", updatedAt: new Date() },
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Admin resolve error:", err);
    res.status(500).json({ error: "Failed to resolve conversation" });
  }
});

// ─── Admin poll for new messages in a conversation ──────────
adminRouter.get("/conversations/:id/poll", async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const since = req.query.since as string;
    const convo = await prisma.chatConversation.findUnique({ where: { id } });
    if (!convo) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    const where: any = { conversationId: convo.id };
    // Same reasoning as the user poll: the cursor follows changes, not births.
    if (since) where.updatedAt = { gt: new Date(since) };

    const messages = await prisma.chatMessage.findMany({
      where,
      orderBy: { updatedAt: "asc" },
    });

    res.json({ messages: messages.map(formatForAdmin), status: convo.status });
  } catch (err) {
    console.error("Admin poll error:", err);
    res.status(500).json({ error: "Failed to poll" });
  }
});

// ─── Helpers ────────────────────────────────────────────────
function formatMessage(m: any) {
  const deleted = !!m.deletedAt;
  return {
    id: m.id,
    sender: m.sender,
    /**
     * Deleted content does not leave the server.
     *
     * The client is told the message is gone, never what it used to say -
     * otherwise "delete" would mean "hide", and anyone reading the response
     * could still read the thing support withdrew.
     */
    text: deleted ? null : m.text,
    imageUrl: deleted ? null : m.imageUrl,
    deleted,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt ?? m.createdAt,
  };
}

/**
 * The same message, plus the fact that support rewrote it.
 *
 * Only the console sees this. Whether a reply was corrected before they read
 * it is our business, not something to hand the customer - it invites a
 * question about what it used to say that we would then refuse to answer.
 *
 * A separate function rather than a flag on formatMessage, because most call
 * sites are `.map(formatMessage)` and map passes the index as the second
 * argument - a default parameter there would quietly turn itself on for every
 * message after the first.
 */
function formatForAdmin(m: any) {
  return { ...formatMessage(m), editedAt: m.editedAt ?? null };
}

/**
 * Only what support itself said, and only while it still exists.
 *
 * A customer's own words are never support's to rewrite, and a bot line is not
 * a thing anybody typed - so both are refused. Returns the message when it may
 * be changed, or a reason when it may not.
 */
async function adminOwnMessage(
  messageId: string,
): Promise<{ ok: true; message: any } | { ok: false; status: number; error: string }> {
  const message = await prisma.chatMessage.findUnique({ where: { id: messageId } });
  if (!message) return { ok: false, status: 404, error: "Message not found" };
  if (message.sender !== "ADMIN") {
    return { ok: false, status: 403, error: "Only replies sent by support can be changed." };
  }
  if (message.deletedAt) {
    return { ok: false, status: 409, error: "That message was already deleted." };
  }
  return { ok: true, message };
}


// ─── PATCH /conversations/:cid/messages/:id — support rewrites its reply ──
const adminEditSchema = z.object({
  text: z.string().trim().min(1).max(4000),
});

adminRouter.patch(
  "/conversations/:cid/messages/:id",
  validate(adminEditSchema),
  async (req: Request, res: Response) => {
    try {
      const found = await adminOwnMessage(req.params.id as string);
      if (!found.ok) {
        res.status(found.status).json({ error: found.error });
        return;
      }
      if (found.message.conversationId !== req.params.cid) {
        res.status(404).json({ error: "Message not found in this conversation" });
        return;
      }

      const text = String(req.body.text).trim();
      if (text === found.message.text) {
        res.json({ message: formatForAdmin(found.message) });
        return;
      }

      const updated = await prisma.chatMessage.update({
        where: { id: found.message.id },
        data: { text, editedAt: new Date() },
      });

      /**
       * No push for an edit.
       *
       * The first reply already buzzed their phone. Buzzing it again because
       * support fixed a typo turns a correction into a second interruption,
       * and the corrected text is there when they next look.
       */
      res.json({ message: formatForAdmin(updated) });
    } catch (err) {
      console.error("Admin edit message error:", err);
      res.status(500).json({ error: "Failed to edit message" });
    }
  }
);

// ─── DELETE /conversations/:cid/messages/:id — support withdraws it ──
adminRouter.delete(
  "/conversations/:cid/messages/:id",
  async (req: Request, res: Response) => {
    try {
      const found = await adminOwnMessage(req.params.id as string);
      if (!found.ok) {
        res.status(found.status).json({ error: found.error });
        return;
      }
      if (found.message.conversationId !== req.params.cid) {
        res.status(404).json({ error: "Message not found in this conversation" });
        return;
      }

      /**
       * The content goes, the row stays.
       *
       * Clearing text and imageUrl here rather than only hiding them means a
       * withdrawn reply is not sitting in the database waiting to be read by
       * the next thing that queries it. The row survives only to tell a client
       * that already has the message that it is gone.
       */
      const updated = await prisma.chatMessage.update({
        where: { id: found.message.id },
        data: { deletedAt: new Date(), text: null, imageUrl: null },
      });

      res.json({ message: formatForAdmin(updated) });
    } catch (err) {
      console.error("Admin delete message error:", err);
      res.status(500).json({ error: "Failed to delete message" });
    }
  }
);

export { adminRouter as adminChatRouter };
export default router;
