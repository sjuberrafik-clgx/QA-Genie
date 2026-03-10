import BouncingLoader from '@/components/BouncingLoader';

export default function Loading() {
    return (
        <div className="flex items-center justify-center min-h-screen">
            <BouncingLoader label="Loading..." size="lg" />
        </div>
    );
}
