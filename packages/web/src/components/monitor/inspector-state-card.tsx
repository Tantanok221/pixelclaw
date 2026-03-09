import { Clock3 } from "lucide-react";
import { Card } from "../ui/card.js";

interface InspectorStateCardProps {
  description: string;
  title: string;
  withIcon?: boolean;
}

export function InspectorStateCard({ description, title, withIcon = false }: InspectorStateCardProps) {
  return (
    <Card className="flex min-h-[320px] items-center justify-center rounded-3xl border border-border bg-card shadow-none">
      <div className="text-center">
        {withIcon ? <Clock3 className="mx-auto size-5 text-muted-foreground" /> : null}
        <p className={withIcon ? "mt-4 text-sm font-medium" : "text-sm font-medium"}>{title}</p>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      </div>
    </Card>
  );
}
