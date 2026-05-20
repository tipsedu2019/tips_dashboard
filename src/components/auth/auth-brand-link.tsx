import Image from "next/image"
import Link from "next/link"

export function AuthBrandLink() {
  return (
    <Link href="/" className="flex items-center gap-2 self-center font-medium">
      <div className="flex size-10 items-center justify-center rounded-xl border bg-background shadow-sm">
        <Image
          src="/logo_tips.png"
          alt="TIPS 로고"
          width={28}
          height={28}
          priority
          className="size-7 object-contain"
        />
      </div>
      TIPS Dashboard
    </Link>
  )
}
