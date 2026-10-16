// Shared by the landing page and the public guides. No "use client": server pages read these values too.

export const GITHUB = "https://github.com/manarbenkraouda/bopomofo";
export const COFFEE = "https://buymeacoffee.com/manarbenkraouda";

/** The public guide pages, in reading order. The landing footer, the guide header and the sitemap list them. */
export const GUIDES = [
  { href: "/what-is-bopomofo", title: "What is Bopomofo?", short: "What it is" },
  { href: "/bopomofo-chart", title: "Bopomofo chart", short: "Chart" },
  { href: "/bopomofo-tones", title: "Bopomofo tones", short: "Tones" },
  { href: "/zhuyin-keyboard", title: "Zhuyin keyboard", short: "Keyboard" },
] as const;

// The path of ㄅ from the MOE stroke data, as the wordmark.
export const MARK =
  "M768 1686 L728 1640 Q717 1630 720 1626 Q723 1622 733 1626 L794 1655 Q927 1721 958.5 1730.5 Q990 1740 1024 1739 Q1095 1737 1162 1684.5 Q1229 1632 1333.5 1476 Q1438 1320 1503.5 1156.5 Q1569 993 1588 919 L1602 860 Q1607 840 1609.5 828 Q1612 816 1611 803 Q1609 780 1587 754.5 Q1565 729 1510 734 L1301 754 L1060 780 L830 803 Q578 830 455 851 Q332 872 321 871 Q272 870 248 829.5 Q224 789 224 742 Q224 718 230 705.5 Q236 693 263.5 670.5 Q291 648 311.5 627.5 Q332 607 399 523.5 Q466 440 507 363.5 Q548 287 557.5 266 Q567 245 592.5 183 Q618 121 624.5 114 Q631 107 641 105 Q653 104 706 127 Q759 150 782 175.5 Q805 201 805.5 211.5 Q806 222 794 244 L774 282 Q760 307 715 376 Q670 445 601 528 L534 608 Q518 627 509 637 Q500 647 498 652.5 Q496 658 495.5 664.5 Q495 671 508 680 Q521 689 554 686 Q576 685 672 675 Q768 665 1145 632 L1412 609 Q1551 598 1586 589 Q1621 580 1628 580 Q1640 581 1652 587.5 Q1664 594 1694 621 Q1724 648 1736 662 Q1748 676 1774.5 709 Q1801 742 1811.5 758.5 Q1822 775 1822.5 791.5 Q1823 808 1814 832 Q1792 891 1785 912 L1762 981 L1709 1135 Q1693 1182 1651 1282 Q1609 1382 1565.5 1475.5 Q1522 1569 1451 1674.5 Q1380 1780 1271.5 1851 Q1163 1922 1109 1932.5 Q1055 1943 1016 1943 Q961 1945 940.5 1926.5 Q920 1908 889.5 1855.5 Q859 1803 836 1771 Q813 1739 768 1686 Z";

/** The GitHub mark (Simple Icons, CC0-1.0). */
export function GitHubMark() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 .3a12 12 0 0 0-3.8 23.38c.6.12.83-.26.83-.57L9 21.07c-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.08-.74.09-.73.09-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.8 1.3 3.49 1 .1-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.14-.3-.54-1.52.1-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.28-1.55 3.29-1.23 3.29-1.23.64 1.66.24 2.88.12 3.18a4.65 4.65 0 0 1 1.23 3.22c0 4.61-2.8 5.63-5.48 5.92.42.36.81 1.1.81 2.22l-.01 3.29c0 .31.2.69.82.57A12 12 0 0 0 12 .3"
      />
    </svg>
  );
}

export function CoffeeCup() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 9h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z" />
      <path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16" />
      <path d="M8 3.5c-.6.8-.6 1.7 0 2.5M12 3.5c-.6.8-.6 1.7 0 2.5" />
    </svg>
  );
}
