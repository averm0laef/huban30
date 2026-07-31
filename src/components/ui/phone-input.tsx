import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface PhoneInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  value: string;
  onChange: (value: string) => void;
}

const formatPhoneNumber = (value: string): string => {
  // Remove all non-digit characters
  const digits = value.replace(/\D/g, '');
  
  // Handle Russian phone numbers
  let formatted = '';
  
  if (digits.length === 0) {
    return '';
  }
  
  // Start with +7
  if (digits.length >= 1) {
    // If starts with 8 or 7, treat as Russian number
    let normalizedDigits = digits;
    if (digits.startsWith('8') || digits.startsWith('7')) {
      normalizedDigits = '7' + digits.slice(1);
    } else if (!digits.startsWith('7')) {
      normalizedDigits = '7' + digits;
    }
    
    formatted = '+7';
    
    if (normalizedDigits.length > 1) {
      formatted += ' (' + normalizedDigits.slice(1, 4);
    }
    if (normalizedDigits.length >= 4) {
      formatted += ') ' + normalizedDigits.slice(4, 7);
    }
    if (normalizedDigits.length >= 7) {
      formatted += '-' + normalizedDigits.slice(7, 9);
    }
    if (normalizedDigits.length >= 9) {
      formatted += '-' + normalizedDigits.slice(9, 11);
    }
  }
  
  return formatted;
};

const getDigitsOnly = (value: string): string => {
  return value.replace(/\D/g, '');
};

const PhoneInput = React.forwardRef<HTMLInputElement, PhoneInputProps>(
  ({ className, value, onChange, ...props }, ref) => {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const inputValue = e.target.value;
      const digits = getDigitsOnly(inputValue);
      
      // Limit to 11 digits (Russian phone format)
      if (digits.length <= 11) {
        const formatted = formatPhoneNumber(digits);
        onChange(formatted);
      }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      // Allow backspace to work properly
      if (e.key === 'Backspace' && value) {
        const digits = getDigitsOnly(value);
        if (digits.length > 0) {
          e.preventDefault();
          const newDigits = digits.slice(0, -1);
          onChange(formatPhoneNumber(newDigits));
        }
      }
    };

    return (
      <Input
        {...props}
        ref={ref}
        type="tel"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="+7 (XXX) XXX-XX-XX"
        className={cn(className)}
      />
    );
  }
);

PhoneInput.displayName = "PhoneInput";

export { PhoneInput, formatPhoneNumber };
