import { PageLoading } from '@/components/loading/sampforce-loader';

/** While a Console page's code loads: skeletons, then the animated SampForce logo (spec section 3). */
export default function Loading() {
  return <PageLoading className="p-6" />;
}
