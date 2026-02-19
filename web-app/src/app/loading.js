import Spinner from '@/components/Spinner';

export default function Loading() {
    return (
        <div className="flex items-center justify-center min-h-screen">
            <Spinner label="Loading..." size="lg" />
        </div>
    );
}
