"use client";

import Image from "next/image";
import { ENSProfile } from "@/lib/types";
import { Card, CardBody, SectionLabel } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

interface ENSCardProps {
  ens: ENSProfile;
  address: string;
  included: boolean;
}

export function ENSCard({ ens, address, included }: ENSCardProps) {
  const shortAddr = `${address.slice(0, 8)}...${address.slice(-6)}`;
  const initials = ens.name
    ? ens.name[0].toUpperCase()
    : address[2]?.toUpperCase() ?? "?";

  return (
    <Card>
      <CardBody>
        <SectionLabel>Identity</SectionLabel>

        <div className="flex items-center gap-4 mb-4">
          {/* Avatar */}
          <div className="relative flex-shrink-0">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center overflow-hidden ring-2 ring-slate-800">
              {included && ens.avatar ? (
                <Image
                  src={ens.avatar}
                  alt="ENS Avatar"
                  width={56}
                  height={56}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              ) : (
                <span className="text-xl font-bold text-white select-none">
                  {initials}
                </span>
              )}
            </div>
            {/* ENS indicator dot */}
            {included && ens.name && (
              <span className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-slate-900 flex items-center justify-center">
                <span className="text-white text-[8px] font-bold">✓</span>
              </span>
            )}
          </div>

          {/* Name + address */}
          <div className="min-w-0">
            {included && ens.name ? (
              <>
                <p className="text-lg font-semibold text-white truncate">{ens.name}</p>
                <p className="text-xs font-mono text-slate-500 mt-0.5">{shortAddr}</p>
              </>
            ) : (
              <>
                <p className="text-sm font-mono text-slate-300 truncate">{shortAddr}</p>
                <p className="text-xs text-slate-600 mt-0.5">
                  {included ? "No ENS name found" : "ENS lookup not included"}
                </p>
              </>
            )}
          </div>
        </div>

        {/* ENS status badge */}
        <div className="flex flex-wrap gap-2 mb-4">
          {!included ? (
            <Badge label="ENS skipped" variant="gray" />
          ) : ens.name ? (
            <Badge label="ENS registered" variant="green" dot />
          ) : (
            <Badge label="No ENS name" variant="gray" />
          )}
        </div>

        {/* ENS records — only if opted in and name exists */}
        {included && ens.name && (
          <div className="space-y-2 pt-3 border-t border-slate-800">
            {ens.url && (
              <ENSRecord
                icon="🌐"
                label="Website"
                value={ens.url.replace(/^https?:\/\//, "")}
                href={ens.url.startsWith("http") ? ens.url : `https://${ens.url}`}
              />
            )}
            {ens.github && (
              <ENSRecord
                icon="⬡"
                label="GitHub"
                value={`@${ens.github}`}
                href={`https://github.com/${ens.github}`}
              />
            )}
            {!ens.url && !ens.github && (
              <p className="text-xs text-slate-600">No additional ENS records set</p>
            )}
          </div>
        )}

        {/* Opt-out notice */}
        {!included && (
          <p className="text-xs text-slate-700 pt-3 border-t border-slate-800">
            Enable "Include ENS data" before analyzing to include ENS identity.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

function ENSRecord({
  icon,
  label,
  value,
  href,
}: {
  icon: string;
  label: string;
  value: string;
  href: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2.5 text-sm group"
    >
      <span className="text-base w-5 text-center flex-shrink-0">{icon}</span>
      <span className="text-slate-600 text-xs w-14 flex-shrink-0">{label}</span>
      <span className="text-indigo-400 group-hover:text-indigo-300 group-hover:underline transition-colors truncate text-xs">
        {value}
      </span>
      <span className="text-slate-700 group-hover:text-slate-500 transition-colors text-xs ml-auto flex-shrink-0">
        ↗
      </span>
    </a>
  );
}
