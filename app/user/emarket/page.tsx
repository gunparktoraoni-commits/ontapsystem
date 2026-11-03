import MarketPlace from '../../components/MarketPlace';

type SearchParam = string | string[] | undefined;

function firstValue(value: SearchParam): string {
  if (Array.isArray(value)) return String(value[0] ?? '').trim();
  return String(value ?? '').trim();
}

const page = async ({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: SearchParam; reason?: SearchParam; ref?: SearchParam }>;
}) => {
  const params = await searchParams;
  const rawTab = firstValue(params?.tab).toLowerCase();
  const rawReason = firstValue(params?.reason).toLowerCase();
  const referralCode = firstValue(params?.ref).toUpperCase();
  const initialTab =
    rawTab === 'subscription' ||
    rawTab === 'customize-templates' ||
    rawTab === 'paid-templates' ||
    rawTab === 'limited' ||
    rawTab === 'cart'
      ? rawTab === 'paid-templates'
        ? 'customize-templates'
        : rawTab
      : 'purchase';

  return <div className='w-full h-full'> <MarketPlace initialTab={initialTab} reason={rawReason} referralCode={referralCode} /></div>;
};

export default page;
