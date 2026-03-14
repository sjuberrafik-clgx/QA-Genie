import BouncingLoader from '@/components/BouncingLoader';
import RobotMascotLogo from '@/components/RobotMascotLogo';

export default function Loading() {
    return (
        <div className="min-h-screen bg-gradient-to-b from-white via-surface-50 to-surface-100/80 px-6">
            <div className="mx-auto flex min-h-screen w-full max-w-5xl items-center justify-center">
                <div className="w-full max-w-sm rounded-[28px] border border-surface-200/80 bg-white/90 px-8 py-10 shadow-card backdrop-blur-sm">
                    <div className="mb-7 flex items-center justify-center">
                        <div className="rounded-[28px] bg-[radial-gradient(circle_at_30%_20%,rgba(180,92,255,0.24),transparent_42%),radial-gradient(circle_at_72%_72%,rgba(31,158,171,0.18),transparent_48%),linear-gradient(180deg,rgba(248,250,252,0.96),rgba(255,255,255,0.9))] p-2.5 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
                            <RobotMascotLogo size={84} emphasis="hero" />
                        </div>
                    </div>
                    <BouncingLoader
                        label="Loading workspace"
                        caption="Preparing your chat, tools, and dashboard context."
                        size="lg"
                    />
                </div>
            </div>
        </div>
    );
}
