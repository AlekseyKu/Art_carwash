import smallIcon from "../assets/vehicle-classes/small.png";
import sedanIcon from "../assets/vehicle-classes/sedan.png";
import crossoverIcon from "../assets/vehicle-classes/crossover.png";
import suvIcon from "../assets/vehicle-classes/suv.png";
import busIcon from "../assets/vehicle-classes/bus.png";

const ICONS: Record<string, string> = {
  small: smallIcon,
  sedan: sedanIcon,
  crossover: crossoverIcon,
  suv: suvIcon,
  bus: busIcon,
};

export function vehicleClassIconSrc(iconKey: string): string | undefined {
  return ICONS[iconKey] ?? ICONS[iconKey.toLowerCase()];
}
