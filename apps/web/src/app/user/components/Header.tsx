import clsx from 'clsx';
import { IoArrowBack } from 'react-icons/io5';
import { useTranslation } from '@/hooks/useTranslation';

interface ProfileHeaderProps {
  onGoBack: () => void;
}

const ProfileHeader: React.FC<ProfileHeaderProps> = ({ onGoBack }) => {
  const _ = useTranslation();

  return (
    <div
      // The strip spans the full width with no background, so its empty
      // middle is an invisible overlay that swallows clicks on whatever
      // scrolls beneath it; it lets clicks through and only its own controls
      // stay interactive.
      className='pointer-events-none fixed z-30 flex w-full items-center justify-between py-2 pe-6 ps-4'
    >
      <button
        aria-label={_('Go Back')}
        onClick={onGoBack}
        className={clsx(
          'btn btn-ghost pointer-events-auto h-12 min-h-12 w-12 p-0 sm:h-8 sm:min-h-8 sm:w-8',
        )}
      >
        <IoArrowBack className='text-base-content' />
      </button>
    </div>
  );
};
export default ProfileHeader;
