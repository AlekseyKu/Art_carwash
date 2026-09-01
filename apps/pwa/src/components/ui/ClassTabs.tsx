import { Chip } from "./Chip";
import { vehicleClassIconSrc } from "../../vehicleClassIcons";

export interface ClassTabItem {
  id: string;
  name: string;
  iconKey?: string;
}

export interface ClassTabsProps {
  items: ClassTabItem[];
  value: string;
  onChange: (id: string) => void;
}

export function ClassTabs({ items, value, onChange }: ClassTabsProps) {
  if (!items.length) return null;

  return (
    <div className="class-tabs" role="tablist" aria-label="Класс автомобиля">
      {items.map((item) => {
        const icon = item.iconKey ? vehicleClassIconSrc(item.iconKey) : undefined;
        const selected = value === item.id;

        return (
          <Chip
            key={item.id}
            active={selected}
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(item.id)}
          >
            {icon && <img className="class-tabs__icon" src={icon} alt="" />}
            {item.name}
          </Chip>
        );
      })}
    </div>
  );
}
