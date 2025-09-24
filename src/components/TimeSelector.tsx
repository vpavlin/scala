import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Clock } from 'lucide-react';

interface TimeSelectorProps {
  value: string;
  onChange: (time: string) => void;
  placeholder?: string;
  id?: string;
}

export function TimeSelector({ value, onChange, placeholder = "Select time", id }: TimeSelectorProps) {
  // Generate time options in 15-minute intervals
  const timeOptions = [];
  for (let hour = 0; hour < 24; hour++) {
    for (let minute = 0; minute < 60; minute += 15) {
      const timeString = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
      const displayString = new Date(`2000-01-01T${timeString}`).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
      timeOptions.push({
        value: timeString,
        label: displayString
      });
    }
  }

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id}>
        <div className="flex items-center">
          <Clock className="mr-2 h-4 w-4 text-muted-foreground" />
          <SelectValue placeholder={placeholder} />
        </div>
      </SelectTrigger>
      <SelectContent className="max-h-60">
        {timeOptions.map(({ value: timeValue, label }) => (
          <SelectItem key={timeValue} value={timeValue}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}