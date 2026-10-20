/**
 * Every icon in the app, from Phosphor, under the names the screens already
 * use. One place to swap a glyph, and one weight rule: regular by default,
 * bold where a heavier stroke was asked for (a tick that has to read at 12px),
 * duotone with a lime fill for the page you are on.
 */
import type { CSSProperties } from 'react'
import {
  ArrowCounterClockwiseIcon,
  ArrowDownLeftIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowSquareOutIcon,
  ArrowUpRightIcon,
  ArrowDownRightIcon,
  ArrowsClockwiseIcon,
  BankIcon,
  BellIcon,
  BookOpenTextIcon,
  BuildingsIcon,
  CameraIcon,
  CaretDownIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CaretUpDownIcon,
  ChatCircleIcon,
  CheckIcon,
  CircleNotchIcon,
  ClockCountdownIcon,
  ClockIcon,
  CurrencyBtcIcon,
  DotsThreeIcon,
  CodeIcon,
  CopyIcon,
  DeviceMobileIcon,
  DownloadSimpleIcon,
  EnvelopeSimpleIcon,
  EyeIcon,
  EyeSlashIcon,
  FileTextIcon,
  FingerprintIcon,
  FlaskIcon,
  FunnelIcon,
  GiftIcon,
  GearSixIcon,
  HashIcon,
  HouseIcon,
  ImageSquareIcon,
  InfoIcon,
  KeyIcon,
  LifebuoyIcon,
  LinkSimpleIcon,
  ListChecksIcon,
  ListIcon,
  LockSimpleIcon,
  MagnifyingGlassIcon,
  MapPinIcon,
  MonitorIcon,
  PaperPlaneRightIcon,
  PaperPlaneTiltIcon,
  PaperclipIcon,
  PauseIcon,
  PencilSimpleIcon,
  PlayIcon,
  PlusIcon,
  PrinterIcon,
  QrCodeIcon,
  ReceiptIcon,
  RocketLaunchIcon,
  ShieldCheckIcon,
  ShieldWarningIcon,
  SignOutIcon,
  StorefrontIcon,
  TrashIcon,
  UploadSimpleIcon,
  UserIcon,
  UserMinusIcon,
  UsersIcon,
  WalletIcon,
  WarningIcon,
  XIcon,
  type Icon as Phosphor,
  type IconWeight,
} from '@phosphor-icons/react'

export type { IconWeight }

export interface IconProps {
  className?: string
  style?: CSSProperties
  weight?: IconWeight
  /** Kept from the old set: 2.5 and up reads as bold. */
  strokeWidth?: number
  'aria-hidden'?: boolean
}

function make(I: Phosphor) {
  return function Icon({ strokeWidth, weight, ...rest }: IconProps) {
    return <I weight={weight ?? (strokeWidth && strokeWidth >= 2.5 ? 'bold' : 'regular')} {...rest} />
  }
}

export const AlertTriangle = make(WarningIcon)
export const ArrowDownLeft = make(ArrowDownLeftIcon)
export const ArrowLeft = make(ArrowLeftIcon)
export const ArrowRight = make(ArrowRightIcon)
export const ArrowUpRight = make(ArrowUpRightIcon)
export const ArrowDownRight = make(ArrowDownRightIcon)
export const Bell = make(BellIcon)
export const BookOpen = make(BookOpenTextIcon)
export const Building2 = make(BuildingsIcon)
export const Check = make(CheckIcon)
export const ChevronDown = make(CaretDownIcon)
export const ChevronLeft = make(CaretLeftIcon)
export const ChevronRight = make(CaretRightIcon)
export const ChevronsUpDown = make(CaretUpDownIcon)
export const Clock = make(ClockIcon)
export const ClockCountdown = make(ClockCountdownIcon)
export const Bitcoin = make(CurrencyBtcIcon)
export const Code2 = make(CodeIcon)
export const Camera = make(CameraIcon)
export const Copy = make(CopyIcon)
export const Download = make(DownloadSimpleIcon)
export const ExternalLink = make(ArrowSquareOutIcon)
export const Eye = make(EyeIcon)
export const EyeOff = make(EyeSlashIcon)
export const FileText = make(FileTextIcon)
export const Filter = make(FunnelIcon)
export const Fingerprint = make(FingerprintIcon)
export const FlaskConical = make(FlaskIcon)
export const Gift = make(GiftIcon)
export const Hash = make(HashIcon)
export const House = make(HouseIcon)
export const ImagePlus = make(ImageSquareIcon)
export const Info = make(InfoIcon)
export const KeyRound = make(KeyIcon)
export const Landmark = make(BankIcon)
export const LifeBuoy = make(LifebuoyIcon)
export const Link2 = make(LinkSimpleIcon)
export const ListChecks = make(ListChecksIcon)
export const Loader2 = make(CircleNotchIcon)
export const Lock = make(LockSimpleIcon)
export const LogOut = make(SignOutIcon)
export const Mail = make(EnvelopeSimpleIcon)
export const MapPin = make(MapPinIcon)
export const Menu = make(ListIcon)
export const MessageCircle = make(ChatCircleIcon)
export const Monitor = make(MonitorIcon)
export const MoreHorizontal = make(DotsThreeIcon)
export const Paperclip = make(PaperclipIcon)
export const Pause = make(PauseIcon)
export const Pencil = make(PencilSimpleIcon)
export const Play = make(PlayIcon)
export const Plus = make(PlusIcon)
export const Printer = make(PrinterIcon)
export const QrCode = make(QrCodeIcon)
export const Receipt = make(ReceiptIcon)
export const RefreshCw = make(ArrowsClockwiseIcon)
export const Rocket = make(RocketLaunchIcon)
export const RotateCcw = make(ArrowCounterClockwiseIcon)
export const Search = make(MagnifyingGlassIcon)
export const Send = make(PaperPlaneTiltIcon)
export const SendHorizontal = make(PaperPlaneRightIcon)
export const Settings = make(GearSixIcon)
export const ShieldAlert = make(ShieldWarningIcon)
export const ShieldCheck = make(ShieldCheckIcon)
export const Smartphone = make(DeviceMobileIcon)
export const Store = make(StorefrontIcon)
export const Trash2 = make(TrashIcon)
export const Upload = make(UploadSimpleIcon)
export const UserRound = make(UserIcon)
export const UserX = make(UserMinusIcon)
export const Users = make(UsersIcon)
export const Wallet = make(WalletIcon)
export const X = make(XIcon)

/**
 * A QR code, drawn for this app: three rounded finder squares and a few
 * modules. Reads as a QR at 14px, where the library glyph turns to barcode
 * noise.
 */
export function QrMark({ className, style }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} style={style} aria-hidden>
      <g stroke="currentColor" strokeWidth={1.8}>
        <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
        <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
        <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
      </g>
      <g fill="currentColor">
        <rect x="6" y="6" width="2" height="2" rx="0.6" />
        <rect x="16" y="6" width="2" height="2" rx="0.6" />
        <rect x="6" y="16" width="2" height="2" rx="0.6" />
        <rect x="13.5" y="13.5" width="2.6" height="2.6" rx="0.7" />
        <rect x="17.9" y="13.5" width="2.6" height="2.6" rx="0.7" />
        <rect x="13.5" y="17.9" width="2.6" height="2.6" rx="0.7" />
        <rect x="17.9" y="17.9" width="2.6" height="2.6" rx="0.7" />
      </g>
    </svg>
  )
}
