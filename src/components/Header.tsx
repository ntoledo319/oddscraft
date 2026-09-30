import { useUnifiedWalletContext, useWallet } from '@jup-ag/wallet-adapter';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Button } from './ui/button';
import { ThemeToggle } from './ThemeToggle';
import { useMemo } from 'react';
import { shortenAddress } from '@/lib/utils';

const NAV = [
  { href: '/', label: 'Explore' },
  { href: '/launch', label: 'Launch' },
  { href: '/markets', label: 'Markets' },
  { href: '/create-pool', label: 'Token only' },
];

export const Header = () => {
  const { setShowModal } = useUnifiedWalletContext();
  const { disconnect, publicKey } = useWallet();
  const router = useRouter();
  const address = useMemo(() => publicKey?.toBase58(), [publicKey]);

  return (
    <header className="w-full border-b border-neutral-850 bg-background/80 backdrop-blur-md">
      <div className="flex h-14 w-full items-center justify-between gap-2 px-3 md:h-16 md:px-4">
        <div className="flex min-w-0 items-center gap-5">
          <Link
            href="/"
            className="flex min-w-0 items-center gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <span className="iconify h-5 w-5 ph--chart-line-up-bold" />
            </span>
            <span className="truncate whitespace-nowrap text-base font-bold tracking-tight md:text-xl">
              OddsCraft
            </span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                  router.pathname === item.href
                    ? 'bg-primary/15 text-primary'
                    : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-1.5 md:gap-3">
          {address ? (
            <Button variant="secondary" onClick={() => disconnect()}>
              <span className="iconify h-4 w-4 ph--wallet-bold" />
              {shortenAddress(address)}
            </Button>
          ) : (
            <Button onClick={() => setShowModal(true)}>
              <span className="hidden md:block">Connect Wallet</span>
              <span className="block md:hidden">Connect</span>
            </Button>
          )}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
};

export default Header;
