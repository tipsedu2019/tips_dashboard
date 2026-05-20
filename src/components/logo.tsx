import Image, { type ImageProps } from "next/image"

import { cn } from "@/lib/utils"

type LogoProps = Omit<ImageProps, "src" | "alt" | "width" | "height"> & {
  size?: number
  alt?: string
}

export function Logo({ size = 24, alt = "TIPS 로고", className, ...props }: LogoProps) {
  return (
    <Image
      src="/logo_tips.png"
      alt={alt}
      width={size}
      height={size}
      className={cn("object-contain", className)}
      {...props}
    />
  )
}
